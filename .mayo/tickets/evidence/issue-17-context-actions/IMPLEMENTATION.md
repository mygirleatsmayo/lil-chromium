# Issue #17 — Make context actions truthful everywhere

Branch `surfx/implement-issue-17-truthful-context-acti-sJk3YpkH`. Scope: `extension/` plus the extension-behavior paragraph in `docs/PROTOCOL.md`. `mac/` untouched. No live app, browser, extension, or native-host install.

## Agreed seam

Issue #2 testing decisions 3 and 5, plus the already-agreed production MV3 service-worker harness from issues #4/#5:

- Load real `extension/background.js` in the Node VM harness (`extension/test/harness.js` + `extension/test/chrome.js`).
- Drive public `runtime` messages, `contextMenus` events, windows/tabs, registry storage, focus (`windows.update {focused:true}`), and outgoing host messages.
- Shared JSON fixtures remain the config/open/context contract; this ticket adds no new wire types.
- No new seam. Policy and the shared reparent live in the production worker; tests never import them.

## What landed

One `contextActionAllowed` table (`extension/background.js:1757`) is the only authority for both menu `visible` (`updateContextMenusForTab`) and `onClicked` authorization.

Page **Send to lil** and tab-strip **Send Tab to Lil** both call `sendTabToLil` (`:1851`), which still adopts through `openLil({tabId})`.

Context-menu "Open link in new lil" goes through `openLinkInNewLil` (`:1348`) → `openLil({url})` with an explicit predecessor (`lil` vs `normal-window`). It no longer requires the source window to already be a lil, and it no longer labels a normal window as kind `lil`.

Context-menu "Open link in incognito lil" goes through `openLinkInIncognitoLil` (`:1364`). The Allow-in-Incognito gate and a failed incognito `windows.create` explain on the source page (`incognitoHint`) and never load the URL into a normal lil. Palette/caret `openIncognitoLil` still falls back to a registered normal lil (issue #5).

Tab-strip registration is isolated in `createTabStripSend` (`:1798`) after the other menus exist, so a `tab` lastError or throw omits only that item.

## Red-green slices

| Slice | Red | Green |
|---|---|---|
| 1. "This lil" on a normal page | Item stayed `visible: true`; link items were never policy-updated | Policy hides it; click is authorized by the same table and no-ops |
| 2. "This lil" in a registered lil | Menus refreshed on focus *before* `registerWindow`, so a new lil still looked like a normal page | `refreshMenusForWindow` after register / incognito-set, only when the create asked for focus |
| 3. New/incognito lil offered on normal + registered-lil pages | — (lock-in of slice 1) | Same policy table |
| 4. New lil from a normal tab | Click now created a lil, but `cascadeTabToLil` recorded `priorContext.kind: "lil"` | `openLinkInNewLil` records `normal-window` and focuses/registers through `openLil` |
| 5. New lil from a registered lil names that lil | — (lock-in of slice 4) | Explicit `kind: "lil"` predecessor |
| 6. Incognito lil from a normal tab | — (click no longer requires a lil source) | Unregistered focused incognito popup; source URL unchanged |
| 7. Incognito access denied | `openIncognitoLil` opened the secret URL as a normal registered lil | Hint on the source tab; no window with that URL; empty registry |
| 8. Failed incognito `windows.create` | — (same explain path as 7) | Hint; URL not opened |
| 9. Send to lil inside a registered lil | — (lock-in of slice 1) | Hidden and inert |
| 10. Send Tab to Lil | No `send-tab-to-lil` item | `contexts: ["tab"]`; same `sendTabToLil` adopt; leftover tab stays in the source window; predecessor is that window |
| 11. Unsupported `tab` lastError | — (isolation already in slice 10) | Item omitted; page Send to lil and link items still load and work |
| 12. Throwing `tab` create | — | Same omission; other menus present |
| 13. Incognito menus | — (policy already denied new-lil / this-lil / send) | Hidden + click inert; incognito-lil remains offered |

Issue #16 (`onCreatedNavigationTarget` new-window link policy) and issue #18 (attributable new-tab conversion) were not touched. `cascadeTabToLil` remains the cascade adapter for spawned tabs.

## Menu / context cases

| Context | this lil | new lil | incognito lil | Send to lil | Send Tab to Lil | Sleep |
|---|---|---|---|---|---|---|
| Normal non-incognito page | hidden / inert | visible / opens focused registered lil | visible / incognito lil or explain | visible / reparent | visible / same reparent | hidden |
| Registered lil | visible / navigates this tab | visible / new lil, predecessor = this lil | visible / incognito lil or explain | hidden / inert | hidden / inert | visible |
| Incognito page or incognito lil | hidden / inert | hidden / inert | visible | hidden / inert | hidden / inert | hidden |

## Reparent / registry / focus evidence

- Page Send to lil: existing test still asserts a focused popup, same URL, registry entry (`worker.test.js` "Send to lil from a normal window…").
- Tab-strip Send Tab to Lil: two-tab window; clicked tab becomes the focused registered lil; the other tab remains; `priorContext` is `{kind:"normal-window", windowId: source}`.
- New lil from a normal tab: focused popup, registry entry, `windows.update {focused:true}`, predecessor is the source normal window, source tab URL unchanged.
- New lil from a registered lil: predecessor is `{kind:"lil", windowId: source}` (issue #15 nested-create rule).
- Incognito context-menu success: popup is incognito, focused, **not** in the registry.
- Incognito context-menu failure: no popup, no registry, `tabs.sendMessage` `{action:"incognitoHint"}` to the source tab. Palette `open.incognito` fallback tests remain green.

## Changed files

- `extension/background.js` — shared policy, truthful link/send execution, isolated tab-strip create, post-register menu refresh
- `extension/test/worker.test.js` — 13 MV3 cases at the public menu/window/registry/focus seam
- `extension/test/chrome.js` — `contextMenus.create` callback, `contexts`, `tabContext: "unsupported" \| "throws"`
- `docs/PROTOCOL.md` — context-menu + context-menu-incognito contract (no new native/host messages)
- `.mayosdd/tickets/evidence/issue-17-context-actions/IMPLEMENTATION.md` — this file

## Commands and results

| Command | Result |
|---|---|
| Focused `node --test --test-name-pattern … extension/test/worker.test.js` | Red then green per slice above |
| `pnpm test` | 51 passed, 0 failed (13 new context-action tests) |
| `swift test` in `mac/` | 141 tests in 13 suites passed |
| `make app` | `mac/build/LilChromium.app` assembled and ad-hoc signed. Did **not** run `make install`, `make install-app`, `make install-host`, or `scripts/install-host.sh` |
| `git diff --check` | clean |

Palette/host incognito fallback, prior-context restore, and centralized `openLil` lifecycle tests from #5/#15 stayed green.
