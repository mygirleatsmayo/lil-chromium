# Remediation review 1 — issue #17

Refs resolved. HEAD = remediated `2a05d7e53c778b613027549835964696e1d4bc9e`. Delta vs `bce7b7ec` is non-empty (`extension/background.js`, `extension/test/worker.test.js`, this evidence file). Commits: `cfd805f` (fix), `2a05d7e` (evidence).

## Ledger (fix)

### S1 — resolved

Settled: action is “Open link in this lil”; one internal name; not `linkBehavior`.

Delta: `CTX_SAME_LIL` / `"open-link-same-lil"` → `CTX_THIS_LIL` / `"open-link-this-lil"` in create/update/click; log `"tabs.update ctxmenu same-lil"` → `"… this-lil"`. Tests follow the new id. `linkBehavior: "same-lil"` cascade is untouched (outside this rename).

### P1 — resolved

Settled: context-dependent items start hidden or are policy-synced before they can appear; same `contextActionAllowed` table.

Delta: every `contextMenus.create` in `createContextMenus` / `createTabStripSend` sets `visible: false`. After recreate, `void applyContextMenusForFocusedTab()` runs `updateContextMenusForTab` on `{ active: true, lastFocusedWindow: true }`. `onStartup` awaits the same helper after `restoreWindows()`.

### P2 — resolved

Settled: explain the context-menu failure once on the mounted source page; no pending hint; keep palette/caret pending hints.

Delta: `openLinkInIncognitoLil` `explain` is `broadcastToWindow(tab.windowId, { action: "incognitoHint" })` only (replaces `queueIncognitoHint`). `queueIncognitoHint` remains on the `openIncognitoLil` fallback (unchanged call site).

## New defects (fix delta only)

None. Starting hidden then applying policy is conservative (brief all-hidden before the first query completes), not a lying label. Tab-strip `create` still uses a lastError callback; a failed first `update` leaves that item hidden until a later tab/focus sync — same conservative direction, not a new spec miss.

No `needs adjudication`.
