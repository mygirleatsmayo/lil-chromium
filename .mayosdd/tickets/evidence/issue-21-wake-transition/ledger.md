# Findings ledger — issue #21 (bounded wake transition)

Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` · Reviewed code: `1b2673b79a8d7f798732117440591a07f7e48562`.

Review round 1 (full, two-axis): Standards `29SW89XT` (`cursor-grok-4.6-medium`), Spec `t_fMJVED` (`cursor-grok-4.6-medium`).

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Findings

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| S1 | Standards | The remaining 180 ms floor is calculated in both preload and replacement-fallback paths | **fix** | Keep the timing rule in one small helper used by both paths; do not add a broader timing abstraction. |
| S2 | Standards | Exported `createClock` and configurable `clockStart` are unused by this suite | **fix** | Keep the controlled clock private and fixed until a real caller needs customization. |
| P1 | Spec | Failed worker wake followed by the nap page's direct fallback leaves nap metadata and its capture behind | **fix** | Every path that visibly leaves the nap document must reconcile the registry and delete the capture. Inactive preload navigation must not count as a completed wake. Worker activation/removal/replacement failures must remain truthful and must not clear state or report success until a fresh active document has actually replaced the nap document; provide focused failure coverage. |
| P2 | Spec | The page's 500 ms fallback races the worker's success-at-cap response | **fix** | The page fallback may run only after an explicit worker failure or genuine worker unreachability. It must not compete with the worker's bounded success path at the same deadline. Preserve the 180 ms floor and no-later-than-500 ms visible transition contract. |
| P3 | Spec | `waitForWakeSwap` misses readiness that occurs before its `onUpdated` listener observes it | **fix** | After subscribing, inspect the fresh tab's current status so an already-complete load swaps at the floor; keep the listener/check order race-safe and retain the 500 ms cap. |

## Round 1 outcome

One high and two medium wake-correctness fixes plus two small cleanup fixes are owed. The inactive preload, minimum hold, capped happy path, fresh-document identity, successful cleanup, clean history, controlled-clock seam, and real-Mac QA split otherwise passed.
