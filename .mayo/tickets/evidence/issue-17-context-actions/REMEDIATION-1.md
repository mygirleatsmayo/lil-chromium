# Remediation round 1 — issue #17

Frozen ledger: `.mayosdd/tickets/evidence/issue-17-context-actions/ledger.md`
Pre-fix point: `bce7b7ec02d911f8d8fdac09966a22c79f8125d0`
Worktree only. No live install/launch/reload.

Seam: production `extension/background.js` in the Node MV3 harness (`boot()`). Visibility via `env.menus()`, clicks via `clickMenu`, mount hints via `pendingIncognitoHint`.

## S1 — this-lil identity, not `linkBehavior: same-lil`

**Settled:** the action is “Open link in this lil”. One unambiguous internal name; not a public wire identifier.

**Change**
- `CTX_SAME_LIL` / `"open-link-same-lil"` → `CTX_THIS_LIL` / `"open-link-this-lil"`
- log `"tabs.update ctxmenu same-lil"` → `"tabs.update ctxmenu this-lil"`
- `linkBehavior` values and the same-lil cascade path unchanged

**Verification**
- Red: this-lil menu lookups failed (`visible` of `undefined`)
- Green: `Open link in this lil navigates the current registered lil` and sibling menu tests

## P1 — no visible context item before the first policy decision

**Settled:** every context-dependent item begins hidden or is policy-synchronized before it can appear. Same `contextActionAllowed` table for visibility and clicks.

**Change**
- `createContextMenus` / `createTabStripSend` create every item with `visible: false`
- After recreate (and on `onStartup` after restore), `applyContextMenusForFocusedTab` runs that same table for the focused tab

**Verification**
- Red: after `installed()`, items were `visible: true` with no policy pass
- Green:
  - `install does not show context-dependent menus until policy decides` (no windows → all hidden)
  - `install with an existing page applies the shared policy before any item can appear` (normal page: this-lil/sleep hidden; new-lil/incognito/send shown)

## P2 — context-menu incognito explain once, no pending replay

**Settled:** explain the current action once on the already-mounted source page. Do not queue a mount-time hint. Keep pending hints for palette/caret fallback lils.

**Change**
- `openLinkInIncognitoLil` explain path: `broadcastToWindow(..., { action: "incognitoHint" })` only
- `queueIncognitoHint` still used by `openIncognitoLil` fallback

**Verification**
- Red: `pendingIncognitoHint` was `true` after a context-menu explain
- Green: `context-menu incognito explain does not leave a pending mount hint` (`hint: false`, broadcast still sent)
- Lock-in: `without incognito access the incognito path falls back to a normal lil and hints why` still `pending.hint === true`

## Suite totals

| Command | Result |
|---|---|
| focused red-green MV3 | S1/P1/P2 red then green as above |
| `pnpm test` | 54 pass, 0 fail |
| `swift test` in `mac/` | 141 tests, 13 suites, 0 fail |
| `make app` | success (`mac/build/LilChromium.app`) |
| `git diff --check` | clean |

Ledger and first-review reports untouched. `mac/` production code untouched.
