# Standards review — Issue #14 (palette Return modifiers)

Axis: `AGENTS.md` + `CONTEXT.md` + Fowler ch.3 baseline. Skills: `/swiftui-pro` (AppKit presentation), `/swift-testing-pro`. Target: `release/v0.4...v0.4/issue-14-palette-modifiers` (`b45e1e5`). Read-only; not Spec.

## Findings (by severity)

1. **S1 (medium, judgement)** — `mac/Sources/LilChromiumApp/PaletteModel.swift` `import AppKit` and `action(..., modifiers: NSEvent.ModifierFlags)`.

   **Standard:** `AGENTS.md` — annotate AppKit-touching classes `@MainActor` (Swift 6.2 isolation). This repo keeps that boundary by leaving ranking/query types Foundation-only and putting AppKit on `PaletteController` (already `@MainActor`). Issue #13 recorded `PaletteModel` as Foundation-only.

   **Smell:** Primitive Obsession — the Return chord is four cases (`none` / `⌘` / `⇧` / `⌘⇧`); the full AppKit flag set stands in.

```
import AppKit
func action(..., modifiers: NSEvent.ModifierFlags) -> PaletteAction?
let exactModifiers = modifiers.intersection(.deviceIndependentFlagsMask)
```

   **Risk:** `PaletteTests.swift` now `import AppKit` and smuggles flags as `UInt` (`extraModifiersNeverSubmitAnAction`). Bits in `deviceIndependentFlagsMask` that are not Return keys (`capsLock`, `function`, `numericPad`) veto submit. Fix: a small chord type on the model; map `NSEvent.ModifierFlags` in the controller. Annotating `PaletteModel` `@MainActor` would match the letter of `AGENTS.md` and be the wrong type.

2. **S2 (medium, documented, judgement)** — `mac/Sources/LilChromiumApp/PaletteController.swift` `returnModifiersOnCurrentEvent`.

   **Standard:** `AGENTS.md` — keep `verified:` comments accurate when changing the code they describe.

```
/// ... exact device-independent flags.
/// verified: see research (SO 61806458) — distinguish ⌘-Return from Return
NSApp.currentEvent?.modifierFlags ?? currentModifierFlags
```

   The comment claims device-independent flags; the body returns raw `modifierFlags` (masking moved into the model). Fallback is now stored flags, not “no command”. New `PalettePanel.sendEvent` `.flagsChanged` (live hint while the field editor is first responder) is unmarked OS behavior; the sibling Return path is marked.

No hard documented-standard breach (no three-component / PROTOCOL / `@MainActor` miss on a new UI type).

## Checked, not filed

- `AGENTS.md` contract: `mac/` only; no messages, `config.json`, sockets, slugs, routing, pinned IDs. `CONTEXT.md`: no avoided synonyms. Human-facing docs untouched.
- `PaletteAction` bundles url / incognito / hint (not a Data Clump). Modifier matching lives in one `action` method (not Repeated Switches). `actionHint` is a one-line reuse, not a Middle Man.
- `/swift-testing-pro`: suite is a struct; `#require` for rows; parameterized extra-modifiers; `.bug(id: 14)`; no XCTest / `!` in expects. UInt arguments are S1, not a separate test-API miss.
- `/swiftui-pro`: no SwiftUI in the diff; hint stays `NSTextField`; one-type-per-file overridden by existing `PaletteRow` colocation. Pre-existing `DispatchQueue` in `refreshHistory` is out of diff.
