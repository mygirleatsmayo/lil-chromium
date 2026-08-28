# Remediation review — issue #21, round 3

Head `f8c9ce8` · pre-fix `1822b27` · original `3ce9573`. Refs resolve; delta non-empty (one commit). Ledger-only; no code/test changes. A1 untouched. S1/S2/S3/P1–P4 not reopened.

## Ledger findings (fix)

**P5 — resolved.** Napping `tabs.onUpdated` backstop now requires the updated tab to be active before leftover cleanup:

```
if (reg[key].slept) {
  if (tab.active && !isSleepPageUrl(changeInfo.url)) {
    await clearNapState(
      tab.windowId,
      reg[key].originalUrl || changeInfo.url,
      reg[key].sleepCaptureKey
    );
  }
  return;
}
```

Inactive same-window preload URL events no longer clear nap fields or the capture. P4’s visible-tab path is unchanged: the leftover-nap test still `tabs.update`s the active nap tab and reconciles. New test drives `tabs.create({ windowId, url: originalUrl, active: false })` then a URL `onUpdated` on that tab and asserts `slept`, capture, and the nap document staying in front.

## New defects (fix delta only)

None. The delta is the `tab.active` guard plus that focused test. No new protocol, timer, or hung-API machinery.

## Needs adjudication

None.

## Outcome

P5 **resolved**. No new defects. No ledger regressions.
