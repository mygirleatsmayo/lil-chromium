# Standards review — issue #16

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` … head `b43cdfe0d50918c4b5a2d8ab492ecd61661aabb2` (both resolve; `git diff` non-empty). One commit: `fix(issue-16): apply new-window link behavior to genuine requested targets`.

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, plus the smell baseline. Reviewed hunks: `docs/PROTOCOL.md`, `extension/background.js`. Tests/harness (`worker.test.js`, `chrome.js`) as supporting context only.

## Documented standards (hard)

No breaches.

- **`AGENTS.md` / `PROTOCOL.md` three-component rule.** Classification text + MV3 worker only. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. `mac/` / host correctly untouched. PROTOCOL’s new-window bullet and the #18 leave-alone list now match the worker (popup window or OAuth guard; missing `openerTabId` not decisive).
- **`CONTEXT.md` language.** No new user-facing copy. Comments keep Chromium `type === "popup"` vs **lil**; they do not rename a lil a popup.
- **`AGENTS.md` AppKit `@MainActor` / `verified:`.** No Swift or OS-behavior edits.
- **Lucas’s prose.** PROTOCOL bullets were tightened in lockstep with the worker, not rewritten into different product language.

## Baseline smells (judgement)

No genuine smells in the production hunk.

Branch 1 is now:

```javascript
const isPopupWindow = win.type === "popup";
const authUrl = matchesOAuthGuard(details.url) || matchesOAuthGuard(tab.url);
if (isPopupWindow || authUrl) {
  log("new-window: preserving native popup/auth", win.type, "opener=" + tab.openerTabId);
  return;
}
```

That is the documented rule, not Repeated Switches or Feature Envy. `noOpener` was deleted rather than wrapped. `#18` `linkOwnedTabIds` claim is unchanged.

**Low — Duplicated Code (tests).** Fourteen new cases repeat the same boot / open-lil / spawn / `createdNavigationTarget` shape instead of extending `linkSpawnFromLil`. Maintenance only; harness `settleMisses` / `openerTabId` on `windows.create` are not speculative production hooks.

## Severity

None on production or contract. Small, cohesive worker+PROTOCOL change.
