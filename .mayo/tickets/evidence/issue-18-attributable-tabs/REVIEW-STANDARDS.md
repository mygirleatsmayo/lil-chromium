# Standards review — issue #18

Fixed point `3c36c9a` … head `27dea74`. Production diff: `extension/background.js` (plus test harness). Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`. Baseline smells are judgements.

## Hard documented-standard breaches

### High — PROTOCOL new-window leave-alone vs `tabs.onCreated`

**Source:** `docs/PROTOCOL.md` Extension behavior contract — New-window link handling (v3): if the new tab’s window `type === "popup"` **OR** `openerTabId` is missing **OR** the URL matches the OAuth guard → **do not touch** (no re-parent, no navigate, no registry). Same rule in the v3 `linkBehavior` paragraph: native popups / OAuth are always left alone.

**Hunk:** `chrome.tabs.onCreated` converts an **opener-less**, active tab in the last-focused populated **normal** window while `focusedWindowId` still names a lil, then `cascadeTabToLil`. There is **no** `matchesOAuthGuard` check.

`onCreatedNavigationTarget` already treats missing opener as leave-alone. Command+T does not use that event, but an opener-less (or OAuth) tab that **does** fire both listeners can be preserved by the link handler and then re-parented by this listener. That is a contract breach, not a naming nit.

### Medium — written contract not updated

**Source:** `docs/PROTOCOL.md` (“Three components. One contract”); `AGENTS.md` (contract change lands in all three or none).

This is user-visible window/tab behavior in the same class as the documented `onCreatedNavigationTarget` path. `PROTOCOL.md`, app, and host were not updated. Extension-only is correct **if** this stays out of the contract; as shipped, the contract text no longer describes extension tab ownership.

No `CONTEXT.md` language breaches. No Swift/`@MainActor`/`verified:` issues. No message, socket, slug, or pinned-ID edits.

## Baseline smells (judgement)

### Divergent change / conceptual clash — `lastNormalWindowId`

`onFocusChanged` now maintains a normal-window MRU for conversion:

```javascript
if (win && win.type === "normal" && focusedWindowId === windowId) {
  lastNormalWindowId = windowId;
}
```

`PROTOCOL.md` prior-context rules say there is **no** normal-window MRU fallback (for close/restore). This field is a different use, but it lives in the focus-discipline block and is never cleared on `windows.onRemoved`, so stale dest IDs and two meanings of “last normal” sit in one listener.

Not flagged: reuse of `settleTabAndWindow` / `cascadeTabToLil` (anti-duplication). Test-only `chrome.js` `onCreated` wiring is not a production smell.
