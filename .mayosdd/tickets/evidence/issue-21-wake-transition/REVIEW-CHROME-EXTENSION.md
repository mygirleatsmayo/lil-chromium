# Chrome-extension review — issue #21 (bounded, clean wake transition)

Special additional review. Not the mayo SDD Standards/Spec review.

- **Reviewed code**: `f8c9ce88c7276d33cbc3f8a724c7c158d1ded306` (confirmed HEAD, clean tree).
- **Implementation commits**: `1b2673b7`, `5561c6c5`, `f1354d83`, `f8c9ce88`.
- **Ticket**: GitHub issue #21 "v0.4: Wake through a bounded, clean transition" (open; labels `ready-for-agent`, `high-intelligence`; **0 comments**).
- **Skill**: `/chrome-extension` v1.1.0 — loaded from the main worktree (`~/projects/lil-chromium/.agents/skills/chrome-extension/`); this worktree's `.claude/skills → ../.agents/skills` symlink resolves to a directory that does not carry the skill. Routed references read: `service-worker.md`, `messaging-rpc.md`, `debugging-mistakes.md`, `web-accessible-resources.md`, `storage.md`, `permissions.md`.
- **Scope**: issue #21 only. `extension/overlay.js`, `extension/manifest.json` and `extension/test/overlay*.js` changes sharing the branch are unrelated v0.4 work and are judged only as integration context.
- **Verification run**: `pnpm test` → **133 tests, 133 pass, 0 fail** at HEAD.

The MV3 fundamentals are in good shape. Findings below are ordered by severity.

---

## Required fixes

### F1 — HIGH · correctness + test realism · the page-side cleanup never runs in a real browser

**Location** `extension/sleep.js:195` (`CLEANUP_BOUND_MS = 0`), used at `extension/sleep.js:197-211` (`leaveNap`).

**Current behavior**

```js
const CLEANUP_BOUND_MS = 0;

const cleanup = reconcileNapState();
await Promise.race([cleanup, new Promise((r) => setTimeout(r, CLEANUP_BOUND_MS))]);
location.replace(originalUrl);
```

`reconcileNapState()` cannot resolve before a next-macrotask timer: its first `await` is `chrome.storage.local.get`, a cross-process call into the browser process (`references/storage.md` §1-2; `debugging-mistakes.md` §5 "Storage performance" treats every `chrome.storage` call as an IPC round trip). `setTimeout(resolve, 0)` therefore **always** wins the race. `location.replace` tears the document down while the `get` is still in flight, so the `set` is never issued and `idbDelete` is never reached — the page-side registry reconcile and capture delete are **dead code in production**, for every fallback path, not just the hung-storage one.

**Why the tests do not catch it** — `extension/test/sleep-page-harness.js:130-134` replaces `setTimeout` with a recorder that stores timers and never fires them (`fireTimers` is explicit), while `:110-115` resolves `storage.local.get` in the same turn. That inverts the real ordering: in the harness the cleanup promise always wins. Three tests assert an outcome production cannot produce:

- `sleep-page.test.js:24` "…and reconciles nap state" — asserts `slept`/`sleepCaptureKey`/`originalUrl`/`originalTitle` cleared and the capture removed;
- `sleep-page.test.js:62` "a worker message error … with cleanup";
- `sleep-page.test.js:73` "a thrown send … with cleanup".

`sleep-page.test.js:83` (hung storage) asserts the *only* behavior real Chrome ever produces.

**Guidance** SKILL.md architecture overview (extension page ↔ SW are separate contexts; every `chrome.*` call crosses a process boundary) and `references/debugging-mistakes.md` §6 "Testing strategies" — a fake must not make an IPC-backed API faster than a timer.

**Impact, stated honestly** No user-visible leak today: the worker's `tabs.onUpdated` backstop (`background.js:825`) clears the registry and deletes the capture when the active tab leaves the nap URL, and the sweep's orphan pass (`background.js:1524`) is a further net. But shipped behavior does not match `docs/PROTOCOL.md` ("It starts reconciling the registry and deleting the capture itself, but waits only a bounded time"), and three tests certify behavior that cannot occur.

This is **not** a settled interpretation: `REVIEW-REMEDIATION-2.md:38` explicitly records "`CLEANUP_BOUND_MS = 0` is a duration choice the ledger does not pin."

**Smallest change** Give the bound a real value — `150` fits inside the 180 ms image floor and is an order of magnitude below the 1000 ms unreachability deadline:

```js
const CLEANUP_BOUND_MS = 150;
```

**Focused verification** `pnpm test`. The three cleanup tests keep passing (the harness fires no timers during `flush()`), and `sleep-page.test.js:83` needs its predicate widened from `(ms) => ms < 1000` to also fire the bound timer. Add one assertion that the bound is scheduled at the intended delay via the existing `page.scheduledDelays()` accessor, so a future regression to `0` is caught by the suite rather than by a browser.

---

## Optional — needs real-browser evidence, not a failing verdict

### F2 — MEDIUM · `replaceTabDocument` on the extension's own page

**Location** `extension/background.js:1160-1173`, called from the preload-unavailable wake fallback at `background.js:1380`.

**Current behavior** The fallback releases the nap document with `chrome.scripting.executeScript` targeting the nap tab. At entry (`sleepLil:1257`) the target is an ordinary `http(s)` page covered by `host_permissions: ["<all_urls>"]`. At wake the target is a `chrome-extension://` page — a scheme `<all_urls>` does not match (`references/permissions.md`, host-permission scope; `debugging-mistakes.md` §3 "Cannot access contents of url … Extension manifest must request permission").

**Consequence if Chrome refuses** `replaceTabDocument` returns `false`, `wakeLil` returns `false`, the nap page's own `location.replace` fallback fires — no strand, no leak, but the worker-side "hold the floor and replace in place" path is inert and `worker.test.js:1495` proves nothing about it. The fake `executeScript` (`extension/test/chrome.js:608-616`) models no scheme restriction.

**Recommendation** One real-Mac check: nap a lil, then from the SW console run `chrome.scripting.executeScript({target:{tabId:<napTabId>}, func:()=>location.href})`. If it resolves, close this as verified and add a `verified:` comment at `background.js:1160` per `CLAUDE.md`. If it rejects, the smallest fix is to delete the worker-side fallback branch and return `false` so the page's own replace runs — less code, identical contract, since the page fallback is a true `location.replace`.

### F3 — LOW · the leftover-nap backstop can fire on the *fresh* tab mid-wake

**Location** `extension/background.js:825` — `if (tab.active && !isSleepPageUrl(changeInfo.url))`.

**Current behavior** The P5 fix correctly ignores the inactive preload, but it identifies the nap tab only by `tab.active`. Between `tabs.update(freshTab, {active: true})` (`:1395`) and `clearNapState` (`:1410`) the fresh tab is active. A late redirect landing in that window fires `onUpdated` with `active: true` and a non-nap URL, so the backstop runs `clearNapState`. In the removal-failure branch (`:1402-1409`) `wakeLil` then rolls the nap document back in front and reports failure — with nap metadata already wiped and the capture already deleted.

Same class as ledger finding P5, different event source. It self-heals: the page receives `ok:false`, runs `leaveNap`, and navigates away. Requires a redirect inside a two-API-call window.

**Guidance** `references/service-worker.md` §1 (event ordering is not serialized against in-flight handlers).

**Smallest change** A module-level `const wakingWindowIds = new Set()` that `wakeLil` adds/removes around the swap, checked by the backstop. SW globals are lost on termination (`debugging-mistakes.md` §4 mistake 1), which is fine here — the guard is only meaningful while the SW is alive running the wake, and its absence degrades to today's behavior.

**Focused verification** One worker test: drive `tabs.onUpdated` for the fresh tab with `active: true` while `rejectTabRemove` is set, and assert nap state survives.

### F4 — LOW · the preload's window placement is assumed, not checked

**Location** `extension/background.js:1367-1372`.

**Current behavior** `chrome.tabs.create({windowId, url, active: false})` targets a lil window, created as `type: "popup"` (`background.js:640`). The whole feature rests on Chromium honouring `windowId` for a popup and letting `tabs.update(id, {active:true})` swap which tab the popup shows. `freshTab.windowId` is never compared to `windowId`. If Chromium ever relocated the tab, `wakeLil` would remove the nap tab from a now-empty popup, `windows.onRemoved` (`:851`) would deregister the lil, delete the capture and unwind prior context — the lil would vanish.

**Recommendation** Treat the multi-tab-popup mechanism as a real-Mac QA item alongside the visible animation the ledger already assigns there. Cheap guard regardless:

```js
if (!freshTab || freshTab.id === undefined || freshTab.windowId !== windowId) { /* fallback branch */ }
```

**Focused verification** Extend `worker.test.js:1495` to also cover a create that lands in another window, once the fake can express it.

### F5 — LOW · the settle-race on the readiness re-check is uncovered

**Location** `extension/background.js:1324` — `void safe(chrome.tabs.get(tabId), …)`.

**Current behavior** The P3 post-subscribe inspection is correct, but `safe()` swallows a transient rejection. Chromium's post-spawn `tabs.get` miss is real enough that the fake models it (`extension/test/chrome.js:88-91`, `settleMisses`) and three unrelated tests use it — but no wake test does. On a miss with readiness already past, the swap waits the full 500 ms cap instead of the 180 ms floor. Degradation only; the cap still holds, so this is coverage, not a defect.

**Smallest change** One test: `boot({ clock: true, settleMisses: { [originalUrl]: 1 } })` combined with the `onCreated`-completes-early pattern from `worker.test.js:1384`, asserting the swap lands at the cap and stays truthful. Optionally retry the inspection once on rejection.

---

## Optional optimizations

- **O1 — nap page as a web-accessible resource.** `manifest.json` exposes `sleep.html`/`sleep.js` to `<all_urls>` (pre-existing, outside #21). #21 gave that page a new privileged action: any page that opens `sleep.html?k=<key>` makes it clear registry nap fields and delete an IndexedDB capture on the first click or keypress, and `u` is still unvalidated before `location.replace`. MV3's default extension CSP blocks a `javascript:` `u`, so this is hardening, not a hole. Per `references/web-accessible-resources.md` "Security implications": validate `u` is `http`/`https` before replacing, and consider `use_dynamic_url: true`. Also closes the hand-crafted `?u=` case where `leaveNap` no-ops while `waking` stays `true`, leaving the page unresponsive to further clicks.
- **O2 — `clearNapState` early-out.** `background.js:1333` — add `if (!entry || !entry.slept) return;` so the duplicate backstop/`wakeLil` call becomes a true no-op instead of a redundant registry write. One line.

---

## Checked and clear

Recorded so these are not re-raised.

- **`return true` in the message listener** — `background.js:2021`, literal, synchronous, outside the async IIFE. Single `onMessage` listener in the file, so the "first listener wins" hazard (`messaging-rpc.md` §1 Response rules) does not apply. Errors fall through to a `sendResponse({ok:false})` in a nested try/catch.
- **Listener registration** — every SW listener is top level except the transient `chrome.tabs.onUpdated` inside `waitForWakeSwap` (`:1321`). That is not `debugging-mistakes.md` mistake 5: a top-level `tabs.onUpdated` listener already exists at `:812`, so Chrome wakes the SW for the event; the transient listener only observes an operation that is already running and is removed in `finish()` on every exit path.
- **SW lifetime** — the bounded path is ≤500 ms and the page's 1000 ms unreachability deadline sits far inside the 30 s idle timeout that the `onMessage` event resets (`service-worker.md` §1). No keep-alive or `chrome.alarms` is warranted, and no `setTimeout` in the wake path approaches the 5 s ceiling from SKILL.md "What NOT to do".
- **`sender.tab`** — `sleep.html` renders in a tab, so `sender.tab.windowId` is populated and `senderWindowId` correctly scopes `wakeLil`.
- **Timer bookkeeping in `waitForWakeSwap`** — `done` guards re-entry, `floorTimer !== null` makes readiness idempotent, the cap is computed from `startedAt` (so `tabs.create` latency counts against the 500 ms), and the `capTimer` TDZ reference inside `finish` is unreachable because every caller runs after assignment.
- **No MV3 prohibitions** — no `eval`/`new Function`/remote code, no `webRequest` blocking, no `localStorage`/`sessionStorage` in the SW, `executeScript` uses `func` not `code`.
- **Ledger items not reopened** — A1 (the 1000 ms silent-worker backstop) and the settled P1–P5/S1–S3 interpretations are taken as given. F3 is adjacent to P5 but is a different event source and was not covered by the P5 remediation.

---

## Bottom line

One required fix (**F1**), one verification item that may become a small simplification (**F2**), three low-severity hardening/coverage items (**F3–F5**), two optional cleanups. Nothing blocks the ticket's acceptance criteria as observed through the current suite; F1 is required because production and its tests disagree about what happens on every nap-page fallback.
