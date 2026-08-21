# Issue #21 — Wake through a bounded, clean transition

Branch: `surfx/implement-issue-21-bounded-clean-wake-tr-auk7-qJT`
Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2`
Scope: the wake transition only. Nap policy/shortcut (#22) and brand/animation work (#24) were not touched. #20's settled entry (replacement-only release, truthful rollback, current-tint restoration, capture identity, named nap-page inputs) is preserved unchanged.

## Agreed seam

Unchanged from issue #20: the production MV3 service worker (`extension/background.js`) loaded by `extension/test/harness.js` against the fake Chrome / IndexedDB boundary. Tests drive the public `wakeLil` runtime message and assert windows/tabs, journal order, session history, IndexedDB captures, registry state, and the reply contract.

Harness additions are Chrome-boundary fakes only, and opt-in so existing tests are untouched:

- `boot({ clock: true })` — a manually advanced clock backs the worker sandbox's `Date.now` / `setTimeout` / `clearTimeout` (`harness.js` `createClock`). No wall-clock sleeps anywhere in the new tests.
- Document identity — every tab navigation in the fake assigns a fresh `documentId` (`chrome.js`), so a newly loaded document is distinguishable from a resumed one.
- Controlled readiness — fake tabs start `status: "loading"` and only `setTabState(tabId, {status: "complete"})` fires the readiness event the worker waits on.
- `removeListener` on fake events (the wake readiness listener detaches), `rejectTabCreate` fault injection, and `messageLater` (send a runtime message without awaiting the reply so the test can drive the clock mid-wake).

## Design

Wake is worker-driven so the bounds are testable at the existing seam:

1. The nap page click sends `wakeLil`. The worker immediately creates an **inactive tab loading the original URL in the same lil window** — the load begins while the static nap image stays painted.
2. The swap happens once the fresh tab reports `status: "complete"`, never before the **180 ms floor**, and never waits past the **500 ms cap** (the swap proceeds regardless at the cap).
3. The swap activates the fresh tab and removes the nap tab. The fresh document is a new load (fresh document identity), and the nap tab's history entry dies with it — no internal nap URL survives in back/forward.
4. Only after the fresh document exists does the worker clear the nap-only registry fields (`slept`, `sleepCaptureKey`, `originalUrl`, `originalTitle`), keep the lil registered, and delete the capture.
5. If the preload tab cannot be created, the worker holds the floor and releases the nap document in place through entry's replacement-only `replaceTabDocument` (history stays clean). If no fresh navigation can be produced at all, wake reports `{ok:false}` and leaves nap state fully intact.
6. The nap page keeps its 500 ms hard fallback (`location.replace` to the original URL), now gated on the reply contract: it fires only when the worker reported failure or is unreachable, so a failed/unavailable worker can neither strand the page nor orphan the capture. A successful wake removes the nap page long before the fallback timer can fire.

## Red-green slices

Each slice: failing test first (`node --test --test-name-pattern …`), then the minimum production change.

1. **Bounded preload-and-swap, cleanup, reply.** Red: `1 !== 2` — no fresh tab was created. `wakeLil` rewritten: preload tab at t=0, readiness held to the 180 ms floor, swap, `clearNapState`, truthful reply. (The message handler was also fixed to reply `{ok: woke}` — it previously always replied `ok: true`.)
2. **Readiness after the floor gates completion.** Ready at 250 ms: no swap at 180, swap immediately on the ready signal. Passed against slice 1's implementation; pins AC3.
3. **500 ms cap.** Red: at 500 ms both tabs still present (no cap existed). Added the cap timer to `waitForWakeSwap`.
4. **Fresh document identity.** Woken tab's `documentId` differs from both the released original document's and the nap document's.
5. **History cleanliness.** Fresh tab history is exactly `[originalUrl]`; no `sleep.html` URL survives in any remaining tab's history. (The old wake pushed onto the nap history entry — `[nap, original]`.)
6. **Preload unavailable.** Red: nap URL still present after the floor, `ok:false`. Added the bounded replacement fallback (floor, then `replaceTabDocument`; same tab, `[originalUrl]` history, full cleanup, `ok:true`).
7. **Total navigation failure.** `ok:false`; nap page, nap registry truth, and capture exactly as before the failed wake — nothing stranded, nothing orphaned.

## Acceptance criteria → evidence

Deterministic = Node MV3 suite at the fake Chrome boundary (`extension/test/worker.test.js`, 7 new tests, all green below).

| # | Criterion | Evidence |
|---|---|---|
| 1 | Wake begins loading the original URL while the static nap image remains visible | Deterministic: slice 1 asserts the inactive fresh tab loading the original URL exists in the same window while the nap tab is still active at t=0 (journal: `tabs.create` before any swap). Visible aspect: real-Mac QA. |
| 2 | The image remains for at least 180 ms | Deterministic: slice 1 signals readiness at t≈0, advances the controlled clock to 179 ms — no swap; swap lands at 180 ms. Slice 6 asserts the fallback path likewise holds the floor (nap URL at 179 ms, replaced at 180). |
| 3 | After 180 ms, the transition completes as soon as the fresh page is ready | Deterministic: slice 2 — past the floor with no readiness there is no swap; the ready signal completes the transition immediately. |
| 4 | The transition stops waiting and proceeds no later than 500 ms | Deterministic: slice 3 — no readiness signal: still waiting at 499 ms, swap at 500 ms. |
| 5 | Fresh document identity, not the released document resumed | Deterministic: slice 4 — the woken document id is fresh vs. both the original live document and the nap document (per-navigation `documentId` at the fake boundary). |
| 6 | Successful wake removes the capture and clears all Nap-only registry fields while keeping the lil registered | Deterministic: slices 1 and 6 — `slept`/`sleepCaptureKey`/`originalUrl`/`originalTitle` deleted, registry entry retained with `url` restored, IndexedDB capture removed, reply `ok:true`. |
| 7 | No stale internal Nap destination in back/forward history after wake | Deterministic: slice 5 — fresh tab history `[originalUrl]`, no nap URL in any tab; slice 6 — the fallback's in-place replacement leaves `[originalUrl]`, never a pushed nap entry. |
| 8 | A failed or unavailable worker cannot leave the nap page permanently stuck or leak capture state | Deterministic: slice 7 — total navigation failure reports `ok:false` with nap page, registry, and capture fully intact (the capture stays referenced, never orphaned). The reply contract is what lets the nap page's 500 ms fallback fire only on failure/unreachability (`extension/sleep.js`); the page-side navigation itself is real-Mac QA. Truly orphaned captures remain covered by the existing sweep `cleanupOrphanCaptures`. |
| 9 | Deterministic MV3 tests use controlled clocks and document identities; real-Mac QA judges the visible animation | The 7 tests run on `boot({clock:true})` with zero wall-clock sleeps; document identity is the fake's per-navigation `documentId`. Visible animation is listed below. |

## Changed files

- `extension/background.js` — bounded wake (`wakeLil`, `waitForWakeSwap`, `clearNapState`), truthful `wakeLil` reply, updated wake comments
- `extension/sleep.js` — fallback fires only on failed/unavailable worker (reply-gated), updated comments
- `extension/test/chrome.js` — document identity, controlled tab status, `removeListener`, `rejectTabCreate` injection
- `extension/test/harness.js` — opt-in controlled clock, `messageLater`
- `extension/test/worker.test.js` — 7 wake tests
- `docs/PROTOCOL.md` — the Lil Nap bullet's wake contract replaces "bounded wake timing is a later ticket"
- `.mayosdd/tickets/evidence/issue-21-wake-transition/IMPLEMENTATION.md`

Internal legacy identifiers (`sleep*`, `sleep.html`, wire params `k`/`u`/`t`/`tint`) and all user-facing Lil Nap language are unchanged. No manifest/permission change. No Swift change. Shared fixtures unchanged. README/CHANGELOG untouched.

## Commands and results

### Focused red-green

`node --test --test-name-pattern '…' extension/test/worker.test.js` per slice; reds recorded above. Final green:

- wake loads the original URL behind the nap image and swaps to the fresh document once it is ready after the 180ms floor
- after the 180ms floor the wake transition completes as soon as the fresh page is ready
- the wake transition stops waiting and swaps no later than 500ms
- wake produces a fresh document identity rather than resuming the released document
- back/forward history holds no stale internal nap destination after wake
- when the wake preload is unavailable, wake holds the floor and replaces the nap document in place
- when wake cannot navigate at all, it reports failure and leaves nap state truthful

### `pnpm test`

```
ℹ tests 89
ℹ pass 89
ℹ fail 0
```

(82 pre-existing + 7 new.)

### `swift test` in `mac/`

```
Test run with 163 tests in 16 suites passed after 0.096 seconds.
```

### `make app`

Worktree build only; produces `mac/build/LilChromium.app` with `LilChromiumApp` + `lilchromium-host`. Environment note: this shell shadows `rm` with `~/.local/bin/rm`, which errors on nonexistent paths and breaks the bundle script's `rm -rf`; the build was run with `/bin` first in `PATH`. Did not run `make install`, `make install-app`, `make install-host`, or `scripts/install-host.sh`. Did not touch the live app, browser, extension, or native host.

### `git diff --check`

Clean.

## Manual real-Mac QA remaining

Real-browser, not run here (live environment left untouched):

- The visible transition itself: nap image holds ~180–500 ms, no blank flash, no tab-strip flicker when the inactive preload tab exists briefly in the lil window, capped wake shows the still-loading page acceptably.
- Chromium accepting an inactive extension-created tab in a `type:"popup"` lil window across the supported browser family (if a build rejects it, the bounded replacement fallback engages by construction — worth observing explicitly).
- The nap-page hard fallback with the worker truly unavailable (e.g. extension reloaded while napping): the page navigates itself to the original URL at ~500 ms.
