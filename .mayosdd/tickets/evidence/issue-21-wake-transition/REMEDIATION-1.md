# Issue #21 — Remediation round 1

Branch: `surfx/issue-21-remediation-round-1-outcome-res-x6aISoMa`
Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` · Reviewed: `1b2673b79a8d7f798732117440591a07f7e48562` · Pre-fix integration: `423448e61ecc4a752113a76ea8bd922bb50620c3`
Scope: exactly the five **fix** findings in the frozen ledger (`ledger.md`). Skill allowlist: `/mayosdd-tdd` only; red → green, one vertical slice per finding, at the existing MV3 production seam (production service worker under the fake Chrome/IndexedDB boundary; the nap page under the same harness family as overlay.js — production page script, linkedom document, faked extension-page boundary).

## Ledger findings → resolutions

| ID | Resolution |
|---|---|
| S1 | One small helper `wakeFloorRemainingMs(startedAt)` now holds the floor rule, used by both `waitForWakeSwap`'s readiness path and `wakeLil`'s preload-unavailable replacement path. No broader timing abstraction. Behavior pinned by the existing floor/cap tests, which stayed green through the refactor. |
| S2 | `createClock` is no longer exported and takes no start parameter (fixed `1_700_000_000_000`); `boot` no longer accepts `clockStart`. Suite-wide green confirms no caller needed either. |
| P1 | Three parts. (a) Worker truthfulness: `wakeLil` checks the activation result and the nap-tab removal result; success and `clearNapState` now happen only after a fresh active document has actually replaced the nap document. Activation failure drops the preload and reports `ok:false` with nap state untouched; removal failure reactivates the nap tab, drops the preload, and reports `ok:false`. Inactive preload completion no longer counts as a completed wake. (b) Replacement-failure truthfulness was already settled by issue #20's S1 path and remains pinned by "when wake cannot navigate at all…". (c) Page fallback: the nap page's own departure now reconciles the registry (clears `slept`/`sleepCaptureKey`/`originalUrl`/`originalTitle`, keeps the lil registered, restores `url`) and deletes the capture from IndexedDB before `location.replace`, matched to the lil by its capture identity. |
| P2 | The page fallback no longer schedules at the worker's 500 ms deadline. It runs immediately on an explicit failure reply, a message error, or a thrown send; a no-reply backstop at 1000 ms — past the worker's 500 ms cap plus reply margin — covers a genuinely unreachable worker, and by construction can never fire on the success path (a successful swap removes the nap page long before it). The worker's 180 ms floor and 500 ms cap are untouched. |
| P3 | `waitForWakeSwap` subscribes its `onUpdated` listener first, then inspects the fresh tab via `tabs.get`; an already-complete load swaps at the floor. Listener-then-check order is race-safe (double observation is idempotent via the existing guards); the 500 ms cap is retained. |

`docs/PROTOCOL.md` updated in lockstep — only the wake sentences whose contract wording changed: readiness observation (P3), success-only-after-actual-replacement plus rollback/failure reporting (P1), and the fallback's trigger conditions and self-cleanup (P1/P2). No other wording touched; no messages, config, sockets, slugs, routing, or pinned IDs changed; app/host untouched.

## Focused red → green evidence

Each test failed against the pre-fix code for the stated reason, then passed after its production fix. (Pre-fix suite: 122 pass / 0 fail; post-fix: 130 pass / 0 fail = 122 pre-existing + 8 new.)

| Test | Red (pre-fix) | Green (post-fix) |
|---|---|---|
| `wake swaps at the floor when the fresh page finished loading before the worker's readiness listener attached` (P3) | At 180 ms both tabs still present — the missed readiness held the swap to the cap | Swap lands at the floor (180 ms), `ok:true` |
| `when wake cannot activate the fresh document, it reports failure and leaves the nap exactly as it was` (P1) | Reply `ok:true`; nap state cleared while the nap document remained visible | `ok:false`; preload removed; nap tab active on the nap page; registry nap fields + capture intact |
| `when the nap tab cannot be removed, wake puts it back in front, reports failure, and keeps nap state` (P1) | Reply `ok:true`; state cleared with the nap tab surviving | `ok:false`; nap tab reactivated; preload removed; nap state + capture intact |
| `an explicit worker failure runs the page fallback at once and reconciles nap state` (P1/P2) | No navigation without the 500 ms timer; registry/capture never cleaned | Immediate navigation to the original URL; registry reconciled; capture deleted |
| `the page fallback does not compete with the worker's bounded path at the 500ms deadline` (P2) | The page's 500 ms timer navigated while the worker reply was still pending | No navigation at the deadline with a pending reply; the 1000 ms no-reply backstop navigates with cleanup |
| `a worker message error (unreachable worker) runs the fallback at once with cleanup` (P1/P2) | No navigation/cleanup without the 500 ms timer | Immediate navigation + registry/capture cleanup |
| `a thrown send (invalidated context) runs the fallback at once with cleanup` (P1/P2) | Same red | Same green |
| `a successful worker reply keeps the nap page on the worker's bounded transition` (P2 guard) | Passed pre-fix too; pins that no page-side deadline fires on the success path | Green |

Focused commands: `node --test --test-name-pattern '<name>' extension/test/worker.test.js` and `node --test extension/test/sleep-page.test.js`.

## Full verification

- `pnpm test` — 130 tests, 130 pass, 0 fail (122 pre-existing + 8 new: 3 worker-side wake tests, 5 nap-page tests). No wall-clock sleeps; worker tests run on the controlled clock, page tests fire captured timers explicitly.
- `swift test` (from `mac/`) — 163 tests in 16 suites passed.
- `make app` — worktree release build succeeded (`mac/build/LilChromium.app`). Run with `/bin` first in `PATH` (this shell's shadowed `rm` breaks the bundle script otherwise). No `make install` / install script run; the live app, browser, extension, and native host were never touched.
- `git diff --check` — clean.

## Changed files

- `extension/background.js` — `wakeFloorRemainingMs` helper (S1); `waitForWakeSwap` post-subscribe `tabs.get` readiness check (P3); `wakeLil` activation/removal truthfulness with rollback (P1); wake comments kept accurate.
- `extension/sleep.js` — fallback fires only on explicit failure or genuine unreachability (1000 ms no-reply backstop), reconciles registry + deletes capture before navigating (P1/P2); `idbDelete` + registry-key mirror; comments updated.
- `extension/test/worker.test.js` — 3 new wake tests (P3, activation failure, removal failure).
- `extension/test/chrome.js` — `rejectTabUpdate` / `rejectTabRemove` fault injection, same opt-in pattern as `rejectTabCreate`.
- `extension/test/sleep-page-harness.js` (new) — production `sleep.js` + real `sleep.html` under linkedom; faked runtime replies, `storage.local` registry, IndexedDB captures, recordable `location.replace`, captured timers.
- `extension/test/sleep-page.test.js` (new) — 5 nap-page fallback tests.
- `extension/test/indexeddb.js` — fake object store gained `get` (the nap page's read path).
- `extension/test/harness.js` — `createClock` private, fixed start (S2).
- `docs/PROTOCOL.md` — wake contract wording for P1/P2/P3, in lockstep with the extension.
- `.mayosdd/tickets/evidence/issue-21-wake-transition/REMEDIATION-1.md` (this file).

## Settled behavior preserved (pinned green)

Inactive preload in the same lil window; 180 ms image floor on both the swap and replacement-fallback paths; swap as soon as ready after the floor; 500 ms cap; fresh document identity; clean back/forward history; retained lil registration with `url` restored; issue #20 entry semantics (replacement-only release, rollback, current-tint restore); issue #22 policy/shortcut behavior; restart restoration of recorded napping lils (leaked nap state would have re-napped a woken lil — the P1 page-side cleanup removes that failure mode).

## Real-Mac QA still required

Not run here (live environment untouched):

- The visible transition itself (image hold ~180–500 ms, no blank flash, no tab-strip flicker), unchanged from the initial round.
- The nap-page fallback on a real system: extension reloaded while napping → page navigates itself after the no-reply backstop and its own registry/capture cleanup can be observed (e.g. no re-nap on next restart).
- Worker activation/removal failures are not directly forceable by hand; they are covered deterministically by fault injection above. Worth observing only if a supported browser build misbehaves on inactive tab creation in a popup window (the bounded replacement fallback remains the observable safety path).
