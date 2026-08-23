# Final Spec review — issue #18 (attributable tabs)

Fixed point `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · Head `f696b898bd694fb325b2005472373de84ad4c421` · Diff `3c36c9a...HEAD` non-empty. Sources: issue #18 (no comments), parent #2 (no comments), ledgers #5/#15/#18, `CONTEXT.md`, `docs/PROTOCOL.md`, `REVIEW-REMEDIATION-1.md`. Product delta: `docs/PROTOCOL.md`, `extension/background.js`, `extension/test/{chrome,worker}.js`.

Settled #18 ledger: S1/S2/P2 **fix** (remediation **resolved**); S3/P1 **won't-fix**. No adjudication.

## Findings

None.

## Checked (no miss / no extra / no wrong)

**Issue #18 ACs.** Worker snapshots `focusedWindowId` + `lastNormalWindowId` from `windows.onFocusChanged` at `tabs.onCreated`. Command+T (`chrome://newtab/`) and current-browser utility (`https://…`) convert only on that public tie (active, opener-less, dest = last focused populated `type === "normal"`). No timestamps/delays/sender/browser lists. Background tabs, competing normal windows, empty/new windows, focus already on dest, and `WINDOW_ID_NONE` stay put. Adoption is `cascadeTabToLil` → `openLil({ tabId, priorContext: { kind: "lil", windowId } })` — registered, focused, chained. MV3 cases cover event-order (onCreated before `onCreatedNavigationTarget`, opener-less + OAuth), competing windows/lils, stale source, success, and safe non-conversion.

**Parent #2.** Story 53 / decision 33: convert Cmd+T and utility opens when public events tie; “Do not broadly capture unrelated normal tabs based only on timing.” Story 54 uses the same tie, not a PopClip detector. Decision 28 / 44: missing opener is not sole evidence — settle + link claim + OAuth/popup leave-alone (ledger S1). Decision 36 / #15 interp 1: `WINDOW_ID_NONE` is real external focus, not a lil source. Decision 50: no blacklist, frontmost override, sender-PID, or Chrome Beta workaround. Decision 51: no new wire fields; S2 settled extension-only + protocol bullet.

**Protocol.** New-tab bullet matches code: public-event identity; dest attribution (stale id = leave-alone, not restore MRU — S3); ownership order (`linkOwnedTabIds` at navigation-target entry before any `await`); link leave-alone wins; incomplete tie left where Chromium put it.

**#5 / #15.** Shared lifecycle; nested create names source lil; unfocused restore / `type: "popup"` API untouched.

**Not reopened.** P1 (`windowId === -1` attach) remains unsupported premise. P2 covered by the two in-flight claim tests.
