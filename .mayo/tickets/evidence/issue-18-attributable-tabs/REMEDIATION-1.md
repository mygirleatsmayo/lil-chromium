# Remediation 1 — issue #18 (attributable new tabs)

Frozen ledger: `ledger.md` at `28ccf28e76067157b97d167233eb659f72338ebd`. Fixed point `3c36c9a`, reviewed code `27dea74`. Scope: `extension/` + `docs/PROTOCOL.md` only. No live app/browser/extension/host mutation; no ledger/report edits.

## S1 (fix) — link-claimed tab must never be converted by the new-tab flow

**Change** (`extension/background.js`):

- New `linkOwnedTabIds` set. `webNavigation.onCreatedNavigationTarget` adds `details.tabId` synchronously at listener entry, before any `await`. The event is the public signal that a tab was created to host a navigation from another tab, so the new-window link flow owns the decision for it (act or leave alone). Command+T / utility opens never fire it. Tab ids are session-unique; entries live for the service worker's lifetime.
- `tabs.onCreated` conversion now returns when `linkOwnedTabIds.has(tab.id)` at decision time (after `settleTabAndWindow`, beside the existing opener/active/window re-checks), and when `matchesOAuthGuard(live.url || live.pendingUrl)` matches — the same OAuth guard the link flow applies. Both checks are pure event/URL identity: no clocks, TTLs, sender heuristics, or browser lists.

Missing-opener and OAuth leave-alone rules are preserved twice over: the link flow keeps deciding (unchanged), and the new-tab flow now defers to its claim and its guard. Issue #5 shared adoption (`cascadeTabToLil` → `openLil`) and issue #15 predecessor semantics are untouched.

## P2 (fix through S1) — public event-order race coverage

**Change** (`extension/test/worker.test.js`): helper `linkSpawnFromLil` plus two tests —

- "an opener-less link spawn is left alone even when tabs.onCreated runs before the navigation claim" (a `rel="noopener"`-style spawn: no `openerTabId`, so only the navigation event ties it to the link flow).
- "an OAuth link spawn is left alone even when tabs.onCreated runs before the navigation claim".

No `windowId === -1` case was added (settled: unsupported premise).

**How the test proves ownership wins without time proximity:** the helper calls `chrome.tabs.create` without awaiting it, reads the new tab id from the journal (written synchronously before the fake fires `tabs.onCreated`), then fires `onCreatedNavigationTarget`. Both listeners are therefore in flight in Chromium's real pipeline order — `tabs.onCreated` first, the navigation claim while that listener is still awaiting its first API call — and the interleaving is microtask-deterministic: no timers, no settle-delay reliance, no wall clock anywhere in the test or the mechanism. The only thing that can save the tab is the claim recorded by the navigation event, i.e. public event identity. Pre-fix both tests fail with the spawn converted (`2 popup windows ≠ 1`); post-fix the spawn stays in its normal window and the registry holds only the source lil.

## S2 (fix) — contract documents the attribution rule

**Change** (`docs/PROTOCOL.md`, Extension behavior contract): new bullet "Attributable new-tab conversion (v4, issue #18)" describing the positive conversion tie (focused lil at `onCreated`, active opener-less tab, already-populated last-focused normal window), the ownership order (navigation-target claim wins regardless of listener order; popup/missing-opener/OAuth leave-alone always win), safe non-conversion when the tie is incomplete, and the explicit note that this is extension-only with no message/socket/config/app/host wire change.

## Verification

| Command | Result |
|---|---|
| focused `node --test --test-name-pattern="tabs.onCreated runs before the navigation claim"` | red pre-fix (both tests: spawn converted, 2 popups ≠ 1) → green post-fix (2 pass) |
| `pnpm test` | 50 passed, 0 failed (48 prior + 2 new) |
| `swift test` in `mac/` | 141 tests in 13 suites passed |
| `make app` (worktree only) | `mac/build/LilChromium.app` built; no install/launch steps run |
| `git diff --check` | clean |

## Changed files

- `extension/background.js` — `linkOwnedTabIds` claim set; navigation-target claim at listener entry; claim + OAuth guards in `tabs.onCreated`; section comment.
- `extension/test/worker.test.js` — `linkSpawnFromLil` helper + two event-order race tests.
- `docs/PROTOCOL.md` — issue #18 attribution contract bullet.
- `.mayosdd/tickets/evidence/issue-18-attributable-tabs/REMEDIATION-1.md` — this file.
