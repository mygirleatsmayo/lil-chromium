# Standards review — issue #19

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` … head `94bf858b708617622eb1f40f85b9bd904acdc2b7` (both resolve; `git diff` non-empty). One commit: `Isolate hoverbar address editing from page shortcuts.`

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, plus the smell baseline. Production hunks: `docs/PROTOCOL.md`, `extension/overlay.js`. Tests/harness only as supporting context. Not Spec.

## Documented standards (hard)

No breaches.

- **`AGENTS.md` / `PROTOCOL.md` three-component rule.** Delta is overlay keyboard isolation plus the matching hover-bar sentence. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. Same extension-only pattern PROTOCOL already uses for overlay/hover-bar behavior. `mac/` correctly untouched.
- **`CONTEXT.md` language.** Hunks do not add user-facing copy or avoided synonyms (popup / default browser / sleep).
- **`AGENTS.md` AppKit `@MainActor` / `verified:`.** No Swift or OS-behavior edits. No new `verified:` claims.
- **Lucas’s prose.** PROTOCOL hover-bar bullet was extended, not rewritten. README/settings copy untouched.

## Baseline smells (judgement)

No genuine smells in the production hunks.

Containment is one helper on the two nodes PROTOCOL names:

```
function containEditingKey(e) {
  e.stopPropagation();
}
for (const type of ["keydown", "keyup", "keypress"]) {
  addr.addEventListener(type, containEditingKey);
  omni.addEventListener(type, containEditingKey);
}
```

That is not Speculative Generality (the three types are the contract) and not Duplicated Code (omni rows are not independently focused; the extra listener is the stated suggestions boundary). Arrow/Enter/Esc remain on the existing `addr` `keydown` handler; `containEditingKey` does not `preventDefault`, matching “native insertion … not canceled.”

Document-capture Esc now returns while `addrFocused()`, and the field’s second Esc clears `hideTimer` then `hide()`. Two call sites, one `hide()` — not Shotgun Surgery or Repeated Switches. Overlay.js was already the hoverbar module; this is not new Divergent Change.

Redundant `e.stopPropagation()` on the Esc arm is leftover, not a design smell. `linkedom` is test-only.

## Severity

None. Small, cohesive overlay+contract change; names match behavior; no three-component or glossary breach.
