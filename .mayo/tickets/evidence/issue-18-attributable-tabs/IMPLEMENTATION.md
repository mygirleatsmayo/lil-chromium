# Issue #18 — Convert only attributable new tabs into lils

Branch: `surfx/implement-issue-18-attributable-new-tab--rQx3VUkh`
Scope: `extension/` (production worker + MV3 harness). `mac/` and `docs/PROTOCOL.md` untouched. No live app/browser/host mutation.

## Agreed seam

Production MV3 service worker (`extension/background.js`) driven by the existing Node harness (`extension/test/harness.js` + `chrome.js`). Tests fire public `tabs` / `windows` / `webNavigation` events and assert created/updated windows, registry entries, focus, and the journal. No new seam. Shared JSON fixtures unchanged.

## Durable attribution state

Two values updated only from public `windows.onFocusChanged`:

- `focusedWindowId` — last Chromium-focused window, including `WINDOW_ID_NONE`.
- `lastNormalWindowId` — last focused window whose `windows.get` reports `type === "normal"`.

`tabs.onCreated` snapshots both **synchronously** before any `await`, then converts only when all of these hold:

1. The new tab is `active` and has no `openerTabId` (browser-UI / utility, not a link spawn).
2. `focusedWindowId` is a registered (or in-memory incognito) lil, and is not the tab's own window.
3. The tab's window is `lastNormalWindowId`, `type === "normal"`, not a lil, and already has sibling tabs.

Conversion calls existing `cascadeTabToLil` → `openLil({ tabId, priorContext: { kind: "lil", windowId } })`, so issue #5 lifecycle and issue #15 predecessor chains apply unchanged.

No timestamps, MRU proximity windows, sender PID, frontmost-browser override, PopClip blacklist, or Chrome Beta workaround.

## Red-green slices

| Slice | Test (red then green) | What landed |
|---|---|---|
| Harness | existing suite still green after wiring `tabs.onCreated` | Fake Chrome fires `onCreated` for `tabs.create` and for a window's initial URL tab; adopted `tabId` moves do not. |
| 1 | Command+T active newtab while a lil is focused | `onCreated` listener + `cascadeTabToLil` |
| 2–7 | utility URL; background tab; opener/link flow; focus already on the normal window; `WINDOW_ID_NONE`; competing focused lil; first tab of a new normal window | Guards already required so slice 1 did not break existing tests; these tests lock them |
| 8 | tab in a competing (not last-focused) normal window | `lastNormalWindowId` snapshot |
| 9 | Command+T into the last-focused of two normals | confirms slice 8 did not over-restrict |

## Attribution vs non-attribution

**Converts**

- Active opener-less tab in the last-focused populated normal window while `onFocusChanged` still names a lil (Command+T `chrome://newtab/` and current-browser utility `https://` URLs).
- Competing lils: chains `priorContext` to the focused lil, not the other.
- Competing normals: still converts when the tab lands in `lastNormalWindowId`.

**Leaves the browser-created tab untouched**

- `active: false`.
- `openerTabId` set (owned by `webNavigation.onCreatedNavigationTarget` / `linkBehavior`).
- Focus already moved to the destination normal window before `onCreated`.
- `WINDOW_ID_NONE` (stale / external).
- Tab in a normal window that is not `lastNormalWindowId`.
- Sole tab of a newly created normal window (Cmd+N / `windows.create`).

## Public-API limitation

Chromium has no event that names “Command+T” or “utility open”. `tabs.onCreated` plus `openerTabId` / window type / the `onFocusChanged` stream are the reliable public signals. If focus has already left the lil before `onCreated`, or the tab appears in a window Chromium never focused as `type: "normal"`, attribution is not reliable and the tab is left alone rather than guessed.

## Changed files

- `extension/background.js` — `lastNormalWindowId`; `tabs.onCreated` conversion.
- `extension/test/chrome.js` — public `tabs.onCreated`.
- `extension/test/worker.test.js` — issue #18 cases.
- `.mayosdd/tickets/evidence/issue-18-attributable-tabs/IMPLEMENTATION.md` — this file.

## Commands and results

| Command | Result |
|---|---|
| focused `node --test` during slices | red Command+T, then green; red competing-normal, then green |
| `pnpm test` | 48 passed, 0 failed |
| `swift test` in `mac/` | 141 tests in 13 suites passed |
| `make app` | `mac/build/LilChromium.app` built and ad-hoc signed |
| `git diff --check` | clean |
