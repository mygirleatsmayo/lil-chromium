# Spec review — issue #14

Spec: `gh issue view 14` (comments: none) and parent `gh issue view 2` (comments: none). Diff: `release/v0.4...v0.4/issue-14-palette-modifiers` (`b45e1e5`). Issue #13 ledger ranking/ghost-text interpretations do not change Return composition.

## High — (c) exact-match treats lock/key-origin bits as extra modifiers

> Each action matches the exact modifier set; extra modifiers never accidentally trigger it.

> Return opens the selected action.

> Standard paste, text editing, arrow navigation, Command+L, and submission conventions remain fixed.

#2 story 39: “exact shortcut matching, so that extra modifiers do not accidentally trigger an incognito action.”

`PaletteModel.action` equality-compares `modifiers.intersection(.deviceIndependentFlagsMask)` to `[]` / `[.shift]` / `[.command]` / `[.command, .shift]`, else `return nil`. That mask includes `.capsLock`, `.numericPad`, `.function`, and `.help` — not held extras like Option/Control.

Probed against the same equality:

- Return + Caps Lock → nil
- Keypad Enter (`.numericPad`) → nil
- Return + Fn (`.function`) → nil
- All four requested combos + Caps Lock → nil
- Option / Control extras → nil (correct)

`activateSelection` returns on nil, so the palette stays open and does not submit. Pre-change `commandHeldOnCurrentEvent` only asked `contains(.command)`; plain Return always opened. `extraModifiersNeverSubmitAnAction` encodes the miss (`capsLock` / `numericPad` / `function`). `modifierFlagsDidChange` stores the same mask, so Caps Lock also blanks the selected-row hint.

## (a) Missing / partial

None. The four Return mappings, selection vs force-search, live `flagsChanged` hints, and native URL/incognito assertions are present. Force-search uses `searchRow` on the trimmed query and ignores `selectedRow`; plain/⌘ Return use `selectedRow.actionURL`.

## (b) Unrequested

No extra user-facing policy beyond the over-broad mask above. Clicks still pass `[]`. Paste / arrows / ⌘L paths are untouched.

## Checked, no defect

⌘ / ⇧ / ⇧⌘ compose as specified. Hints use Mac glyphs (`⏎ Open`, `⇧⏎ Search`, `⌘⏎ Open Incognito`, `⇧⌘⏎ Search Incognito`). Ledger SI5 (URL-like Open then Search) unchanged; SI7 still uses the selected row unless force-search.
