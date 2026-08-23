# Remediation review — issue #21, round 1

Head `5561c6c` · pre-fix `423448e` · original `3ce9573`. Delta non-empty (one commit). Ledger-only; no code/test changes.

## Ledger findings (fix)

**S1 — resolved.** One helper, both paths:

```
function wakeFloorRemainingMs(startedAt) {
  return Math.max(0, startedAt + WAKE_MIN_HOLD_MS - Date.now());
}
```

`waitForWakeSwap` and the preload-unavailable branch both call it. No extra timing layer.

**S2 — resolved.** `createClock` is non-exported and takes no start; `boot` uses `createClock()` only.

**P1 — resolved.** Worker: activation falsy → drop preload, `return false` (no `clearNapState`); `tabs.remove` throw → reactivate nap, drop preload, `return false`; success only after replace then `clearNapState`. Inactive preload still waits on swap, not treated as done. Page: `reconcileNapState` (nap fields cleared, lil kept, `url` restored, capture deleted by `k`) then `location.replace`.

**P2 — resolved.** No 500 ms page timer. Fallback on `lastError` / `!reply.ok` / thrown send, plus `if (!answered) leaveNap()` at 1000 ms. Worker floor/cap unchanged.

**P3 — resolved.** Listener first, then `tabs.get`; `ready()` is idempotent (`done || floorTimer`); cap timer kept.

## New defects (fix delta only)

**Medium — page navigate waits on unbounded reconcile.** `leaveNap` always `await reconcileNapState()` (storage then `idbDelete`) before `location.replace`. Catches cover reject, not hang. A stuck `storage.local` / IDB call strands the nap document; the old fallback navigated without waiting.

**Low — PROTOCOL overstates activation rollback.** Delta wording: activation *or* removal failure “puts the nap document back in front.” Code reactivates only on removal failure; activation failure only drops the preload.

## Needs adjudication (not a failure)

Whether a still-running `wakeLil` (blocked on post-cap `tabs.update` / `tabs.remove`) is “genuine unreachability” at 1000 ms. The page then clears registry/capture while the worker may still swap and leave a preload tab. Ledger forbids racing the 500 ms success path; it does not settle this later overlap.

## Outcome

S1, S2, P1, P2, P3 **resolved**. One medium and one low new defect. One adjudication item. No regressions vs the frozen ledger.
