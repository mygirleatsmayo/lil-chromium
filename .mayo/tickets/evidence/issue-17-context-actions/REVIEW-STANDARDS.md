# Standards review — issue #17 (`3c36c9a…d4ee5ba`)

Axis only: documented repo standards + smell baseline (judgement). Not Spec. No skills.

**Verdict:** no hard documented-standard breach. One naming judgement.

## Documented standards

1. **AGENTS.md — three-component contract.** Diff is `docs/PROTOCOL.md` (extension-behavior bullets only), `extension/background.js`, extension tests, evidence. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. `mac/` / host correctly untouched.

2. **AGENTS.md — `@MainActor` / `verified:`.** No Swift. No `verified:` in the hunks; `createTabStripSend` lastError omit is PROTOCOL-specified, not a new on-box claim.

3. **AGENTS.md — tests / prose.** Tests drive the production service worker. Lucas-facing copy (README etc.) untouched. Evidence is not product docs.

4. **PROTOCOL.md / CONTEXT.md.** Menu titles in the hunk match the updated context-menus bullet (`"Send Tab to Lil"`, `"Open link in this lil"`, sleep/whitelist strings). PROTOCOL still uses Sleep copy; that overrides CONTEXT.md **Lil Nap** (pre-existing, not introduced). One policy table for visibility and click matches “one policy owns both.”

## Findings

1. **S1 (low, judgement — Mysterious Name)** — `extension/background.js` `CTX_SAME_LIL` / `"open-link-same-lil"` / log `"tabs.update ctxmenu same-lil"` after the handler was renamed to `openLinkInThisLil`.

   **Standard:** smell baseline Mysterious Name; PROTOCOL `linkBehavior` values are `"new-lil"` | `"same-lil"`.

   ```
   const CTX_SAME_LIL = "open-link-same-lil";
   await safe(chrome.tabs.update(tab.id, { url }), "tabs.update ctxmenu same-lil");
   ```

   **Risk:** a later edit can treat this item as config `linkBehavior: "same-lil"` instead of “navigate this registered lil.” Id is sticky once created; rename is optional.

## Baseline smells not filed

- `openLinkInNewLil` / `openLinkInIncognitoLil` share cascade + predecessor shape; incognito correctly ORs `incognitoLils` (never registered). Blind extract would hide that.
- `refreshMenusForWindow` is a one-line hide of `win.tabs[0]`, not a Middle Man.
- Extra `background.js` menu policy is not new Divergent Change.
- `isEphemeralWindow` still the registry∪incognito predicate; callers outside menus keep it.

## Commands

- `git rev-parse` → `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` / `d4ee5ba64ebb22d6c47bc1c5f6eb13bd6179b93f`
- `git log 3c36c9a..HEAD --oneline` — `d4ee5ba Make context-menu actions match their labels.`
- `git diff 3c36c9a...HEAD` — 5 files, non-empty
