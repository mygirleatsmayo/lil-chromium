# Remediation review — issue #21, round 2

Head `f1354d8` · pre-fix `1593a59` · original `3ce9573`. Refs resolve; delta non-empty (one commit). Ledger-only; no code/test changes. A1 untouched.

## Ledger findings (fix)

**P4 — resolved.** Page: `leaveNap` races `reconcileNapState()` against `setTimeout(..., CLEANUP_BOUND_MS)` (`CLEANUP_BOUND_MS = 0`) then `location.replace`. Hung `storage.local.get` cannot hold the document; cleanup may still finish after the bound.

Worker backstop exists: napping `tabs.onUpdated` (after `if (!changeInfo.url) return`) calls `clearNapState` when `!isSleepPageUrl(changeInfo.url)`. Entry navigation to the nap URL is skipped. Focused test updates the nap tab itself and reconciles leftovers.

**S3 — resolved.** PROTOCOL only (no worker change):

> activation failure drops the preload and leaves the already-visible nap document in front; nap-tab removal failure reactivates the nap document and drops the preload; both leave nap state intact and report failure.

Matches A1-adjacent settled split: activation leaves nap in front; removal reactivates it.

## New defects (fix delta only)

**High — backstop clears nap state on the inactive wake preload.** Registry upkeep is keyed by `tab.windowId`, not the visible/nap tab:

```
if (reg[key].slept) {
  if (!isSleepPageUrl(changeInfo.url)) {
    await clearNapState(
      tab.windowId,
      reg[key].originalUrl || changeInfo.url,
      reg[key].sleepCaptureKey
    );
  }
  return;
}
```

`wakeLil` still `tabs.create({ windowId, url: originalUrl, active: false })` while the nap document is in front. A same-window `onUpdated` with the original URL therefore deletes nap fields and the capture before replacement. Activation/removal failure then cannot keep truthful nap state. The chrome fake’s `tabs.create` does not fire `onUpdated` with `url`, so worker wake tests do not see this. P1 is not reopened; this is introduced by the round-2 listener.

## Needs adjudication

None. `CLEANUP_BOUND_MS = 0` is a duration choice the ledger does not pin.

## Outcome

P4 and S3 **resolved**. One high new defect in the worker backstop. No ledger regressions of S3; P4’s named hung-page stranding is fixed.
