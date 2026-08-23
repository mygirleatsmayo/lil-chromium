# Remediation — chrome-extension review round 1 (issue #21)

Source report: `REVIEW-CHROME-EXTENSION.md` (special `/chrome-extension` review at `f8c9ce88`).

**Manager adjudication**: implement **F1** and **F3** only. **F2** deferred pending real-Mac evidence. **F4**, **F5**, **O1**, **O2** won't-fix for issue #21.

Skill allowlist: `/chrome-extension` and `/mayosdd-tdd` only. Red → green at the two existing seams — the production nap page under the sleep-page harness, and the production service worker under the fake Chrome/IndexedDB boundary. No new seam introduced.

The frozen ledger, prior reports, the GitHub issue, and live components are untouched. `docs/PROTOCOL.md` is unchanged: neither fix alters the documented contract, they make the code meet it.

---

## F1 — the page-side cleanup never ran in a real browser

**Defect.** `extension/sleep.js` bounded its fallback cleanup with `CLEANUP_BOUND_MS = 0`. `reconcileNapState()` cannot resolve before a next-turn timer, because its first `await` is `chrome.storage.local.get` — a round trip to the browser process. The zero bound therefore always won the `Promise.race`, and `location.replace` tore the document down while the read was still in flight: the registry reconcile and the capture delete never executed, on every fallback path.

**Why the suite missed it.** `extension/test/sleep-page-harness.js` captured `setTimeout` without ever running it while resolving `storage.local` in the caller's turn — the exact inverse of the real ordering — and its `location.replace` left the page fully alive. Three tests asserted cleanup that production could not perform.

**Change — harness first (the honest model).** Two rules, both stated in the harness header:

1. `chrome.storage.local.get`/`set` resolve on the same manual clock as `setTimeout`, after a simulated `STORAGE_LATENCY_MS = 20` round trip, so an IPC-backed API can never beat a next-turn timer.
2. `location.replace` marks the document unloaded; a round trip that lands afterwards never resolves, because the browser does not deliver a callback into a destroyed page.

The captured-timer `fireTimers(pred)` accessor is replaced by `advance(ms)`, a time-ordered clock modelled on the worker harness's private clock (`extension/test/harness.js`), flushing continuations after each timer. `scheduledDelays()` is kept, now reporting delays relative to now.

**Change — production.** `CLEANUP_BOUND_MS = 150`. Long enough for storage and IndexedDB to answer; short enough to sit inside the worker's own 180 ms image floor, so a hung call still cannot hold the document.

**Backstops preserved, and still proven.** The worker's URL-change reconcile (`background.js`, `tabs.onUpdated`) and the sweep's orphan-capture pass are unchanged. The hung-storage test asserts that when cleanup cannot finish, the page still leaves at the bound and leaves nap fields and the capture to those backstops.

**Red → green.**

| Step | Result |
| --- | --- |
| Harness + tests rewritten, bound still `0` | `node --test extension/test/sleep-page.test.js` → **1 pass, 5 fail**. `an explicit worker failure reconciles nap state before the page leaves` failed with `slept` still `true` and the capture still present; `a hung storage API…` failed on `the bound is a real wait, not an immediate departure` |
| `CLEANUP_BOUND_MS = 150` | **6 pass, 0 fail** |

A regression to `0` now fails five tests rather than passing silently, because navigating first genuinely abandons the cleanup in the harness as it does in Chrome.

---

## F3 — a mid-swap redirect could clear nap state the swap was about to roll back

**Defect.** The leftover-nap backstop identified the user-visible nap tab by `tab.active` alone. Between `tabs.update(freshTab, {active: true})` and `clearNapState`, the fresh tab is active while the nap document still exists. A redirect completing in that window dispatched `tabs.onUpdated` with `active: true` and a non-nap URL, so the backstop cleared nap metadata and deleted the capture — including on the removal-failure path, where `wakeLil` then rolled the nap document back in front and reported failure against a registry that already said "awake".

Same class as ledger finding **P5**, different event source: P5 covered the inactive preload, this is the fresh document after activation. The ledger's settled interpretations are unchanged; this closes a case the P5 remediation did not reach.

### First attempt, rejected on review: an in-flight set

The first fix was a module-level `wakingWindowIds` set that `wakeLil` held across the reversible window, sampled by the listener before its first `await`. **Review correctly rejected it as timing-dependent**: the listener samples the set when its *callback starts*, not when Chrome *queues* the event. An event dispatched mid-swap whose handling begins only after the `finally` released the id would find an empty set and clear state the rollback had just restored. A deterministic test proved it:

`a mid-swap redirect handled only after the rollback still cannot clear nap state` — the wake rolls back first, then the queued `tabs.onUpdated` is delivered. Against the in-flight set this **failed**: `entry.slept` was `undefined` and the capture deleted.

### Shipped fix: a current-state invariant

`napDocumentMayRemain(windowId)` — a `chrome.tabs.query({ windowId })` asking whether any tab in the lil is still on the nap URL (`url` or `pendingUrl`). The backstop clears only when none is:

```js
if (tab.active && !isSleepPageUrl(changeInfo.url) && !(await napDocumentMayRemain(tab.windowId)))
```

Nap state is leftover exactly when no nap document is left to fall back to. The question is asked **at the moment of clearing**, so no sampling window exists and a stale event cannot act on a window that has since changed. `wakingWindowIds` and the `try/finally` bracket in `wakeLil` are removed — `wakeLil` is back to its pre-remediation shape.

**Uncertainty is not "no".** `safe()` yields `null` when the query rejects, so the predicate reads `!tabs || tabs.some(...)` — an unanswerable query counts as *may remain*. The `May` in the name is the invariant, not hedging: clearing on a guess deletes a capture the nap still needs and leaves a napping lil with no image, whereas keeping the state costs only a later URL-change event or the sweep's orphan pass. A first draft returned `!!tabs && …` and failed open at exactly the moment it could not tell; review caught it.

The invariant holds across every path: preload still inactive (P5) and rollback-restored nap tab both leave a nap document, so nothing clears; the page's own fallback and the preload-unavailable replacement both take the nap tab off the nap URL, so the P4 backstop still fires and still reconciles.

No protocol change, no persisted state, no new abstraction.

**Red → green.**

| Step | Result |
| --- | --- |
| Collision test, no guard | `a redirect on the fresh document mid-swap cannot clear nap state before the nap tab is gone` failed — `entry.slept` `undefined`, capture deleted |
| Delayed-delivery test, in-flight set | `a mid-swap redirect handled only after the rollback still cannot clear nap state` failed the same way — the guard was already released |
| Rejecting-query test, `!!tabs && …` | `when the worker cannot tell whether a nap document remains, nap state stays truthful` failed — `slept` `undefined`, capture deleted |
| `napDocumentMayRemain` invariant | **119 pass, 0 fail** in `worker.test.js` |

The three tests drive their cases deterministically: `rejectTabRemove` fires the redirect at the instant removal is refused; the queued event is replayed after the rollback completes; and a new `rejectTabQuery` fault predicate in the fake Chrome boundary rejects exactly the leftover check (the only window query with no `active` filter).

---

## Verification

| Check | Result |
| --- | --- |
| `node --test extension/test/sleep-page.test.js` (F1 focused) | 6 pass, 0 fail (was 1/5 red) |
| `node --test extension/test/worker.test.js` (F3 focused) | 119 pass, 0 fail |
| `pnpm test` | **136 tests, 136 pass, 0 fail** (133 before, +3 F3 tests) |
| `swift test` (`mac/`) | **163 tests, 16 suites, passed** |
| `make app` (repo root) | **Done: `mac/build/LilChromium.app`** |
| `git diff --check` | clean |

`make app` needed `PATH="/bin:$PATH"`: a local shim at `~/.local/bin/rm` shadows `/bin/rm` and errors on a missing path, which breaks the script's `rm -rf "$APP_BUNDLE"` on a clean tree. That is a machine-environment artifact, not a repo defect, and nothing was changed to accommodate it.

No app was installed, launched, reloaded, or quit. `make app` only writes `mac/build/` (git-ignored); `install-app` was not run and `/Applications/LilChromium.app` is untouched (mtime still 2026-08-09).

## Files changed

- `extension/sleep.js` — `CLEANUP_BOUND_MS` `0` → `150`, with the reasoning for both bounds recorded.
- `extension/background.js` — `napDocumentMayRemain()` beside `isSleepPageUrl()`; the leftover-nap backstop gates on it. `wakeLil` unchanged from its pre-remediation shape.
- `extension/test/sleep-page-harness.js` — clocked `chrome.storage.local` round trips, document teardown on `location.replace`, `advance()` replacing `fireTimers()`.
- `extension/test/sleep-page.test.js` — six tests moved onto the clock; explicit assertion that the page does not leave before cleanup lands.
- `extension/test/worker.test.js` — three new F3 tests: the mid-swap collision, the same event delivered only after the rollback, and the leftover check that cannot answer.
- `extension/test/chrome.js` — `rejectTabQuery` fault predicate, matching the existing create/update/remove/scripting injectors.

## Review corrections applied

1. **`make app` was reported unrunnable in error.** The `Makefile` is present and tracked (`3e1e994`); the earlier check ran from `mac/`, where `git ls-files Makefile` resolves to `mac/Makefile`. Run from the repo root and recorded above.
2. **F3's first invariant was timing-dependent** and has been replaced with the current-state check, with the delayed-delivery test that exposed it kept as coverage. Detailed under F3.
3. **The current-state check failed open on a rejected query**, clearing nap state precisely when it could not determine whether a nap document remained. Now fails closed, with a focused test. Detailed under F3.

## Left open

- **F2** — deferred. `replaceTabDocument` still injects into the nap tab (`chrome-extension://`) on the preload-unavailable path; `<all_urls>` does not cover that scheme, and the fake models no scheme restriction. Needs one real-Mac `chrome.scripting.executeScript` check against a live nap tab. If it works, add a `verified:` comment; if not, the branch can be deleted in favour of the page's own replace.
- **F4, F5, O1, O2** — won't-fix for issue #21 by adjudication.
