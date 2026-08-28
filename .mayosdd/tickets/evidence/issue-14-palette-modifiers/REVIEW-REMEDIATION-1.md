# Remediation review 1 — issue #14

Checked: frozen ledger at the review target; fix delta `git diff b45e1e5...v0.4/issue-14-palette-modifiers` (commits `7bd5753` docs, `e628606` fix, `76ce648` tests); sources at `76ce648`. Skills applied only to that delta: `/swiftui-pro` (no SwiftUI; AppKit/model boundary, comments, isolation) and `/swift-testing-pro` (suite struct, `#require`, Cartesian params, `.bug(id: 14)`). Did not run tests (would write `.build` in the review checkout). Did not reopen issue #13 interpretations or accepted Option/Control blocking.

## Ledger

1. **S1 — resolved.** `PaletteModel` drops `import AppKit`. The model takes `PaletteReturnChord`; the `@MainActor` controller maps `NSEvent.ModifierFlags`.

```
struct PaletteReturnChord: OptionSet, Equatable, Sendable {
    static let shift / command / option / control
    static let plain: Self = []
}

static func returnChord(from flags: NSEvent.ModifierFlags) -> PaletteReturnChord {
    if flags.contains(.shift) { chord.insert(.shift) }
    if flags.contains(.command) { chord.insert(.command) }
    if flags.contains(.option) { chord.insert(.option) }
    if flags.contains(.control) { chord.insert(.control) }
}
```

2. **S2 — resolved.** `returnChordOnCurrentEvent` no longer claims “exact device-independent flags.” The existing `verified:` read of `NSApp.currentEvent.modifierFlags` in `doCommandBySelector` is still what the body does. No new `verified:` on `flagsChanged`.

```
/// Return variants share the `insertNewline:` selector. AppKit flags are
/// reduced here to the four keys that participate in the action chord.
/// verified: see research (SO 61806458) — distinguish ⌘-Return from Return
/// via NSApp.currentEvent.modifierFlags in doCommandBySelector.
```

3. **P1 — resolved.** Lock/key-origin bits never enter the chord. Model match is exact on Command/Shift/Option/Control only, so Caps Lock, Keypad Enter (`.numericPad`), Fn, and Help no longer blank the hint or block submit. Option/Control still yield `nil`. Clicks still `activateSelection()` → `.plain`. Tests: four requested chords; `eventMetadataDoesNotChangeReturnChord` (those four × capsLock/numericPad/function/help plus the union); `extraModifiersNeverSubmitAnAction` plus `optionAndControlStayUnsupportedWithEventMetadata`.

## New findings

None.

## needs adjudication

None.

No ledger fix regressed.
