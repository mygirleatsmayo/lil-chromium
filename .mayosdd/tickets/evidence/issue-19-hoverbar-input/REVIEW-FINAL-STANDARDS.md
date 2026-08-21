# Final Standards review — issue #19

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` … head `94bf858b708617622eb1f40f85b9bd904acdc2b7` (both resolve; `git diff …` non-empty). One commit: `Isolate hoverbar address editing from page shortcuts.`

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, smell baseline. Production/test/protocol at that head only. Ledger round 1: no findings; that outcome is final. Evidence Markdown is audit context, not product.

## Documented standards (hard)

No new breaches. Ledger-referenced: overlay isolation plus the matching hover-bar sentence is extension-only; no messages, `config.json`, sockets, slugs, routing, or pinned IDs (`AGENTS.md` / `PROTOCOL.md` three-component rule). `mac/` untouched. No user-facing copy or avoided glossary terms (`CONTEXT.md`). No Swift, AppKit, or `verified:` edits (`AGENTS.md`). PROTOCOL hover-bar bullet extended, not rewritten; README/settings copy untouched (Lucas’s prose).

## Baseline smells (judgement)

No new genuine smells. Ledger-referenced: one `containEditingKey` on `addr` and `omni` for the three contract event types is not Speculative Generality or Duplicated Code.

```
function containEditingKey(e) {
  e.stopPropagation();
}
for (const type of ["keydown", "keyup", "keypress"]) {
  addr.addEventListener(type, containEditingKey);
  omni.addEventListener(type, containEditingKey);
}
```

Existing `addr` `keydown` still owns Arrow/Enter/Esc and does not `preventDefault` on ordinary keys. Document-capture Esc returns while `addrFocused()`; second Esc on the field clears `hideTimer` then `hide()`. Overlay.js remains the hoverbar module (not new Divergent Change). Test-only `linkedom` + overlay harness boot production `overlay.js` with no product hooks; that is not a production Middle Man.

## Severity

None. Cohesive overlay+contract change; names match behavior; no three-component or glossary breach.
