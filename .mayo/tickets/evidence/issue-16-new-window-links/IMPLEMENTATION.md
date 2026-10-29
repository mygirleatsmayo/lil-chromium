# Issue #16 — Apply New-window Links without breaking popups

Branch: `surfx/implement-issue-16-new-window-links-with-iCqr_KqD`
Scope: `extension/` (production worker + MV3 harness) and the classification text in `docs/PROTOCOL.md`. `mac/` untouched (no Swift change — the seam is extension-owned). No wire/config vocabulary change. No live app/browser/host mutation.

## Agreed seam

Production MV3 service worker (`extension/background.js`) driven by the existing Node harness (`extension/test/harness.js` + `chrome.js`) — the same seam used by issues #12/#15/#17/#18 and required by issue #2 testing decision 3. Tests fire public `tabs` / `windows` / `webNavigation` events and assert created/updated/removed windows and tabs, registry entries, focus requests, and the journal. No new seam. Shared JSON fixtures unchanged.

## Root cause and fix

One seam, all callers: `webNavigation.onCreatedNavigationTarget` branch 1 treated a missing `openerTabId` as standalone proof of a native popup. A genuine requested browsing target spawned without an opener (`rel="noopener" target=_blank`, `window.open(url, "_blank", "noopener")`) was therefore "preserved" — stranded as a tab in a normal Host-browser window, ignoring the configured `linkBehavior`.

Fix (`extension/background.js`, new-window link handling): preservation is decided by the settled state together — settled window `type === "popup"` (featureful `window.open` keeps `window.opener`/`postMessage`) or an OAuth-guard URL, requested **or** final. A missing opener alone is no longer decisive; opener-less normal-window spawns follow the effective behavior (config `linkBehavior` flipped by the ⌘ clickHint). The #18 ownership claim (`linkOwnedTabIds`, synchronous at listener entry) is unchanged and still wins over new-tab conversion regardless of listener order.

`docs/PROTOCOL.md` updated in lockstep: the v3 handling bullet's branch 1 and the issue #18 bullet's leave-alone enumeration now read "popup window, OAuth guard".

## Acceptance criteria → code/tests

| # | Criterion | Code | Test (`extension/test/worker.test.js`) |
|---|---|---|---|
| 1 | Ordinary same-target link navigates the current lil | untouched: no navigation-target event fires; `tabs.onUpdated` registry upkeep | "an ordinary same-target link navigates the current lil without creating another window" |
| 2 | Requested new target honors new-lil/same-lil | branch 2: `cascadeTabToLil` / same-lil collapse | existing "new-window target from a lil is re-parented into a cascaded lil"; new "an opener-less requested target follows the configured new-lil behavior" (red→green), "same-lil handling navigates the source, removes the spawned target, and restores focus", "a requested target follows the live hot-applied linkBehavior" |
| 3 | ⌘ per-click override flips only that target | `consumeClickHint` (single-use splice) after the preserve check | "a Command-click flips the configured new-lil behavior for that target only" (incl. consumed-hint re-spawn), "a Command-click flips the configured same-lil behavior for that target only" |
| 4 | Classification waits for the created tab/window to settle | `settleTabAndWindow` retry loop; harness `settleMisses` fault injection | "classification waits for the spawned tab to settle and reads its final navigation state", "a spawned tab that settles late is still classified and cascaded", "a spawned tab that never settles is left untouched" |
| 5 | Popup type + opener + final state + auth guard decide together; missing opener alone not decisive | branch 1: `win.type === "popup" || matchesOAuthGuard(requested) || matchesOAuthGuard(settled)` | "an opener-less requested target follows the configured new-lil behavior" (red→green), "an opener-less link spawn is owned by the link flow even when tabs.onCreated runs first" (rewrite, red→green), "a native popup window keeps its window and opener when it hosts a link target", "a popup window without an opener is still preserved as a native popup", "a guarded auth target in a normal window keeps its native tab and opener", "a guarded auth host-suffix target is preserved", settle/final-state test above |
| 6 | Preserved popup/OAuth flows keep native window and opener | branch 1 returns before any re-parent/navigate/registry write | popup pair and auth pair assert zero `windows.create`/`tabs.update`/`tabs.remove`, window intact, `openerTabId` intact, no registry entry |
| 7 | New-lil creates+focuses only the new lil, records prior context, never raises an incidental normal window | `cascadeTabToLil` → `openLil` (create → explicit focus, explicit `priorContext: {kind:"lil"}`) | "new-lil handling focuses only the new lil and never raises the host window"; existing "a cascaded lil records its source lil despite incidental normal-window focus" |
| 8 | Same-lil navigates source, removes spawned, restores focus | branch 2 same-lil: `tabs.update` → `tabs.remove` → `focusWindow(source)` | "same-lil handling navigates the source, removes the spawned target, and restores focus" (asserts the journal order navigate → remove → refocus) |
| 9 | MV3 coverage: ordinary links, both behaviors, override, settle races, native popups, auth targets | — | this suite; see rows above |

## Preserved settled behavior

- #12 hot-apply: branch 2 reads the cached live context; "a requested target follows the live hot-applied linkBehavior" delivers `config-update` and observes same-lil without reload.
- #15 prior-context/focus discipline: explicit `{kind:"lil"}` predecessor on cascades; focused-create discipline unchanged; full prior-context suite green.
- #17 context actions: untouched; suite green.
- #18 ownership/attribution: `linkOwnedTabIds` claim unchanged; the rewritten race test proves the claim still wins when `tabs.onCreated` runs first — now with the link flow cascading the genuine target instead of stranding it. OAuth race test unchanged and green.

## Changed files

- `extension/background.js` — branch 1 classification (missing opener no longer decisive) + section comments.
- `extension/test/chrome.js` — `settleMisses` fault injection; `windows.create` passes `openerTabId` to a URL-created tab (window.open fidelity).
- `extension/test/worker.test.js` — 14 new issue #16 tests; 1 rewrite of the opener-less event-order race test.
- `docs/PROTOCOL.md` — classification text in lockstep (no wire/config vocabulary change).
- `.mayosdd/tickets/evidence/issue-16-new-window-links/IMPLEMENTATION.md` — this file.

## Commands and results

| Command | Result |
|---|---|
| focused `node --test` slice A | red: opener-less spawn preserved (no cascade) in both new tests, then green after the fix |
| `pnpm test` | 96 passed, 0 failed (83 pre-existing + 14 new − 1 rewritten) |
| `swift test` in `mac/` | 163 tests in 16 suites passed |
| `make app` | `mac/build/LilChromium.app` built and ad-hoc signed (run with system `/bin` first in PATH: the user's `~/.local/bin/rm` shadow exits 1 on `rm -rf` of a not-yet-existing bundle) |
| `git diff --check` | clean |
