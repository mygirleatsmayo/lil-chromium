# Spec review — issue #21 (Wake through a bounded, clean transition)

Fixed `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` → head `1b2673b79a8d7f798732117440591a07f7e48562` (1 commit, 7 files, +530/−38). Refs resolve; diff non-empty. Sources: issues #21, #2, #20; ledgers #5 and #20; `CONTEXT.md`; `docs/PROTOCOL.md` at the review head.

## Findings by severity

### P1 (high) — failed/unavailable wake leaks capture and nap registry

Issue #21 AC8: “A failed or unavailable worker cannot leave the nap page permanently stuck **or leak capture state**.” Parent #2 story 77: “waking to remove the stored capture and nap registry state, so that screenshots and stale metadata do not accumulate.” Decision 46: “Wake produces a fresh document and **cleans the capture/nap registry state**.” Review-head PROTOCOL: the 500 ms `location.replace` fallback exists “so a failed/unavailable worker can neither strand the page **nor orphan the capture**.” Issue #20 AC: restart “restores recorded napping lils as nap documents.”

`wakeLil` on total navigation failure returns `false` and leaves `slept` / `sleepCaptureKey` / `originalUrl` / `originalTitle` plus the IndexedDB blob. `sleep.js` then `location.replace(originalUrl)` without deleting the capture or touching `chrome.storage.local` `ephemeralWindows`. The document is awake; metadata and screenshot remain. `cleanupOrphanCaptures` keeps any key still referenced by the registry. A later restart therefore restores a nap over a lil the user already woke. The MV3 case pins “leave nap state truthful” and never exercises page-fallback cleanup.

### P2 (medium) — page fallback is a 500 ms race, not worker-failure-only

PROTOCOL: fallback “fires **only when the worker failed or is unreachable**.” `sleep.js` sets `owned` only in the `wakeLil` reply callback and always schedules `location.replace` at 500 ms if `!owned`. The worker’s 500 ms cap finishes *then* activate/remove/`clearNapState`/`sendResponse`, so on the success-at-cap path `owned` is still false when the page timer runs. The nap document self-navigates in parallel with the screenshot-backed swap (parent story 75: image remains “while the page reloads”).

### P3 (medium) — swap is not “as soon as ready” if `complete` already happened

AC3: “After 180 milliseconds, the transition completes **as soon as the fresh page is ready**.” Decision 46: “swap as soon as ready after that.” `waitForWakeSwap` only listens for a future `onUpdated` `status: "complete"`; it never `tabs.get`s the created tab. A load that completes before the listener (or is already `complete` on `tabs.create`) waits until the 500 ms cap.

## Checked, no findings

AC1–2 / AC4 happy path: inactive same-window preload, 180 ms floor, 500 ms worker cap. AC5–7 success path: new tab / `documentId`, `clearNapState` deletes nap fields and capture, nap tab removed so history has no `sleep.html`. AC9: `boot({clock:true})` + per-navigation `documentId`; visible animation is real-Mac QA (not run). Issue #20 S1 replacement-only on worker fallback; #5 unfocused restore untouched. Unrequested product surface: none beyond the failure-path races above.
