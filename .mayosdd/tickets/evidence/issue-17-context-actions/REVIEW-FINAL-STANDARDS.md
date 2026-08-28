# Final Standards review — issue #17 (`3c36c9a…89ac852`)

Axis only: documented repo standards + smell baseline (judgement). Not Spec. No skills. Evidence Markdown is audit context, not product.

**Verdict: clean.** No new hard documented-standard breach. No baseline smell worth filing.

## Documented standards

1. **AGENTS.md — three-component contract.** Product hunks: `docs/PROTOCOL.md` (extension-behavior bullets only), `extension/background.js`, `extension/test/{chrome,worker.test}.js`. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. `mac/` / host correctly untouched.

2. **AGENTS.md — `@MainActor` / `verified:`.** No Swift. No `verified:` in the hunks; tab-context omit and hidden-until-policy are PROTOCOL-specified, not new on-box claims.

3. **AGENTS.md — tests / prose.** Tests boot the production service worker. Lucas-facing README/copy untouched.

4. **PROTOCOL.md / CONTEXT.md.** Titles in `createContextMenus` / `createTabStripSend` match the updated context-menus bullet (`Open link in this lil`, `Send Tab to Lil`, sleep/whitelist strings). Sleep copy still overrides CONTEXT.md **Lil Nap** (pre-existing). Visibility and clicks share `contextActionAllowed`.

## Ledger (not re-filed)

- **S1** resolved — `CTX_THIS_LIL` / `"open-link-this-lil"` / log `"tabs.update ctxmenu this-lil"`. Config `linkBehavior: "same-lil"` cascade unchanged (settled: not this action).

Settled interpretations stand. No `needs adjudication`.

## Baseline smells not filed

- `openLinkInNewLil` / `openLinkInIncognitoLil` share cascade + predecessor shape; incognito correctly ORs `incognitoLils`. Blind extract would hide that (same as round 1).
- Policy `switch` vs click `switch` on menu ids: one is allow, one is effect; collapsing them is not owed.
- `refreshMenusForWindow` hides `win.tabs[0]`; not a Middle Man.
- Extra menu policy in `background.js` is not new Divergent Change.

## Commands

- `git rev-parse` → `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` / `89ac85201d58f688434bd7026f8aefd9c90aaaea` (= HEAD)
- `git log 3c36c9a..HEAD --oneline` — `89ac852`, `2a05d7e`, `cfd805f`, `bce7b7e`, `d4ee5ba`
- `git diff 3c36c9a...HEAD` — 10 files, non-empty (product: PROTOCOL + extension)

Standards findings: 0. Worst issue: none.
