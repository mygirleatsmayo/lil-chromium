# Remediation review — issue #21 chrome-extension F1/F3

Head `fd92134` · pre-fix `4352792` · original `3ce9573`. Refs resolve; delta non-empty (`9ae96ee`, merge `fd92134`). Ledger-only; production/tests untouched here.

Skill `/chrome-extension` v1.1.0 from `~/projects/lil-chromium/.agents/skills/chrome-extension/` (this worktree has no copy). Routed refs: `service-worker.md`, `storage.md`, `debugging-mistakes.md`, `permissions.md`. S1–S3 / P1–P5 / F2 / F4 / F5 / O1 / O2 not reopened.

## Ledger findings (fix)

**F1 — resolved.** Page cleanup now has a real bound; the harness no longer certifies a race production cannot win.

```
const CLEANUP_BOUND_MS = 150;
```

`leaveNap` still `Promise.race`s `reconcileNapState()` against that timer, then `location.replace`. 150 ms is long enough for a `chrome.storage.local` IPC round trip (`storage.md` §1–2; `debugging-mistakes.md` §5) and still inside the 180 ms floor. Worker URL-change backstop and orphan sweep are unchanged.

Harness: `STORAGE_LATENCY_MS = 20` on the same clock as `setTimeout`; `location.replace` sets `unloaded` so a later round trip never resolves (`debugging-mistakes.md` §6 — a fake must not make IPC faster than a timer). Hung-storage test pins duration: `advance(149)` still on the nap document with fields intact; `advance(1)` leaves. Success / lastError / thrown-send paths reconcile before leave.

**F3 — resolved.** Nap state stays until no nap document remains, not merely until some other tab is active.

```
if (tab.active && !isSleepPageUrl(changeInfo.url) && !(await napDocumentMayRemain(tab.windowId)))
```

`napDocumentMayRemain` is a current-state `tabs.query({ windowId })` (`url` or `pendingUrl`). Asked at clear time, so a stale `onUpdated` cannot act on a window that has since rolled back (`service-worker.md` §1: SW globals vanish; an in-flight set would sample the callback start, not enqueue time). `safe()` → `null` counts as may remain (`!tabs || …`). Manifest `"tabs"` exposes extension-page URLs on query (`permissions.md` §2). Coverage: mid-swap redirect, same event after rollback, rejecting query.

## New defects (fix delta only)

None.

## Needs adjudication

None.

## Outcome

F1 **resolved**. F3 **resolved**. No new defects. No ledger regressions.
