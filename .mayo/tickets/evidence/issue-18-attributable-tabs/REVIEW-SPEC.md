# Spec review — issue #18 (attributable tabs)

Fixed point `3c36c9a` · Head `27dea74` · Diff `3c36c9a...HEAD` (non-empty). Sources: issue #18, parent #2, ledgers #5/#15, `CONTEXT.md`, `docs/PROTOCOL.md`. No ticket comments.

## 1. Missing or partial

**P1 — High.** Command+T attribution is decided before the tab has a settled window, so the conversion the ticket requires can be skipped on the same attach race the protocol already treats as real.

Issue #18: “Command+T from a focused lil converts when that attribution is reliable.” Also: “The worker observes new active normal tabs while retaining enough public event context to identify an attributable lil source.” And: “MV3 tests cover event-order races…”

`docs/PROTOCOL.md`: “on `onCreatedNavigationTarget` from a lil, WAIT for the tab to settle (retry `tabs.get`/`windows.get`), then branch” — because the attach race is acknowledged for new tabs.

`extension/background.js` snapshots `lastNormalWindowId`, then returns if `tab.windowId !== destWindowId` (and if `tab.windowId === undefined`) **before** `settleTabAndWindow`. `chrome.windows.WINDOW_ID_NONE` is `-1`; an unattached `onCreated` tab with `windowId === -1` is treated as “not the last normal window” and left forever. Harness `tabs.create` always assigns a real `windowId` before `onCreated`, so the suite never exercises this race.

Parent #2 §33: “Convert Cmd+T and current-browser utility opens into registered lils when the public browser events provide a reliable tie.” A lil still named by `onFocusChanged` plus an opener-less active tab is that tie; missing destination id is not a negative tie.

**P2 — Low.** Event-order coverage is only “focus already moved” / `WINDOW_ID_NONE` before `onCreated`, not delayed `openerTabId` or delayed `windowId`. Issue #18 still asks tests to cover “event-order races” as a distinct bullet from “stale source context.”

## 2. Behaviour not requested

None in production. `lastNormalWindowId` is the competing-window context issue #18 requires (“Unrelated normal-window tabs… are never captured”). No PopClip blacklist, sender heuristic, frontmost-browser override, or Chrome Beta workaround (issue #18; parent #2 §50). `WINDOW_ID_NONE` is not used as a lil source (issue #15 settled interpretation 1; protocol: “`windows.onFocusChanged(WINDOW_ID_NONE)` is meaningful external focus state”). Conversion goes through `cascadeTabToLil` → `openLil` with explicit `{ kind: "lil", windowId }` (protocol: “Nested creates explicitly name their source lil”; issue #5 shared lifecycle).

## 3. Implemented but wrong

Covered by **P1**: the guards look like reliable destination attribution but implement “window id already equals last normal,” which is stricter than the ticket and opposite the protocol’s settle-then-decide rule for new-tab attach.
