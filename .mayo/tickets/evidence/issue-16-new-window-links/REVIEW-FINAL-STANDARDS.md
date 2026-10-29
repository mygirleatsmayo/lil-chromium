# Final Standards review — issue #16

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` … review head `b43cdfe0d50918c4b5a2d8ab492ecd61661aabb2` (both resolve; range diff non-empty). Commit: `b43cdfe fix(issue-16): apply new-window link behavior to genuine requested targets`.

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, smell baseline. Ledger `S1` is settled. Reviewed: `docs/PROTOCOL.md`, `extension/background.js`, `extension/test/chrome.js`, `extension/test/worker.test.js`. Evidence Markdown is audit context only.

## Hard breaches

None.

- **`AGENTS.md` / `PROTOCOL.md` three-component rule.** Classification text + MV3 worker only. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. `mac/` / host untouched. New-window branch 1 and the #18 leave-alone list both drop “missing opener is decisive,” matching the worker.
- **`CONTEXT.md` language.** No new user-facing copy. “Popup” remains Chromium `windows.create`/`type === "popup"`, not a rename of a lil.
- **`AGENTS.md` AppKit `@MainActor` / `verified:`.** No Swift or OS-behavior edits.
- **Lucas’s prose.** PROTOCOL bullets tightened with the worker, not rewritten into different product language.

## Smell judgements

No new genuine smells in the production hunk.

Branch 1 is now:

```javascript
const isPopupWindow = win.type === "popup";
const authUrl = matchesOAuthGuard(details.url) || matchesOAuthGuard(tab.url);
if (isPopupWindow || authUrl) {
  log("new-window: preserving native popup/auth", win.type, "opener=" + tab.openerTabId);
  return;
}
```

That is the documented rule. `noOpener` was deleted. Remaining `openerTabId` checks live on the #18 new-tab path, which still requires an opener-less tab — not Repeated Switches of this classification.

Harness `settleMisses` and `openerTabId` on `windows.create` are test-only, not Speculative Generality.

**Ledger `S1` (Duplicated Code, tests) — won't fix.** Repeated boot / open-lil / spawn / `createdNavigationTarget` setup is unchanged in kind from round 1. Not reopened.

## Severity

None on production or contract. Cohesive worker + PROTOCOL change; tests cover the new classification without new production abstractions.
