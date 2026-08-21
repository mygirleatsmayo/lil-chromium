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
| P4 | Spec | Direct page fallback awaits storage and IndexedDB reconciliation without a bound before navigating | **fix** | Cleanup must remain eventual, but a hung cleanup API must not strand the nap document. Bound the page's wait before navigation and retain a worker-side/event-driven cleanup backstop for state the page could not finish. |
| S3 | Standards | PROTOCOL says activation failure puts the nap document back in front, while code only needs that rollback after removal failure | **fix** | State the two truthful failure paths precisely: activation failure leaves the already-visible nap document in front; removal failure reactivates it. |
| P5 | Spec | Round-2 `tabs.onUpdated` backstop clears nap state when the inactive same-window wake preload reports its original URL | **fix** | The backstop may reconcile only navigation of the active, user-visible nap tab. An inactive preload must never clear nap metadata or its capture; add deterministic coverage for that event ordering. |
| F1 | Chrome extension | Page fallback's zero-millisecond cleanup bound always loses to real `chrome.storage` IPC, while the test harness inverts that ordering | **fix** | Give page-side cleanup a real but bounded opportunity to finish, retain worker/orphan backstops, and make the harness protect the intended duration and ordering rather than certifying impossible production behavior. |
| F2 | Chrome extension | Worker replacement fallback injects into the extension-owned nap page | **won't-fix pending evidence** | Real-Mac console verification decides whether Chromium permits this. If it rejects, remove the inert worker branch rather than adding permissions or machinery. |
| F3 | Chrome extension | An active fresh tab can emit a late URL update between activation and nap-tab removal, causing the backstop to clear state before a failed removal rolls back | **fix** | Nap state remains truthful until the nap tab has actually been removed. Use the smallest in-flight-wake guard or stronger existing invariant; do not add a new protocol or persistent state. |
| F4 | Chrome extension | Returned preload window placement is not rechecked | **won't-fix** | `tabs.create` with an explicit valid `windowId` is the platform contract; keep multi-tab popup behavior in Real-Mac QA and reopen only on evidence. |
| F5 | Chrome extension | No wake test covers a transient `tabs.get` rejection during readiness recheck | **won't-fix** | This only degrades to the already-correct 500 ms cap; do not add coverage or retries without observed browser evidence. |
| O1 | Chrome extension | Validate the web-accessible nap page's `u` parameter and consider dynamic URLs | **won't-fix** | Useful hardening but outside issue #21; handle separately if the nap page's exposure model is revisited. |
| O2 | Chrome extension | Early-return from duplicate `clearNapState` calls | **won't-fix** | The current idempotent cleanup still deletes a supplied capture even if registry fields were already cleared; keep that safety property. |

## Round 1 outcome

One high and two medium wake-correctness fixes plus two small cleanup fixes are owed. The inactive preload, minimum hold, capped happy path, fresh-document identity, successful cleanup, clean history, controlled-clock seam, and real-Mac QA split otherwise passed.

## Round 1 remediation review

Review `krz4zBqB` found S1, S2, P1, P2, and P3 resolved. It added P4 and S3 above.

### Adjudication A1

The 1000 ms no-reply backstop is accepted as genuine worker unreachability for this ticket. The 500 ms bound governs the worker-owned visual transition; recovery after a silent/dead worker is a separate safety path. Do not add a second status protocol or speculative machinery for a Chromium API promise that remains pending indefinitely. Real-Mac QA should reopen this only if a supported browser demonstrates such a hang or overlap.

## Round 2 remediation review

Review `ZEV2f8re` found P4 and S3 resolved. It added P5 above: the new window-scoped `tabs.onUpdated` backstop does not distinguish the inactive wake preload from the visible nap tab and can clear truthful nap state before replacement.

## Round 3 remediation review

Review `GZd8CjNa` found P5 resolved with no new fix-delta defects.

## Chrome-extension skill review

Claude Opus 5 High reviewed the completed issue #21 implementation against `/chrome-extension`. F1 and F3 are owed. F2 is evidence-gated; F4, F5, O1, and O2 are settled as above so remediation and final reviewers do not expand scope.
