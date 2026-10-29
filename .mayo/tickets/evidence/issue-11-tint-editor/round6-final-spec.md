# Spec review — Issue #11

No findings.

1. **Met.** One `TintEditor`, two call sites. Lil Nap: `TintEditor(..., label: "Lil Nap tint", offersNoTint: false)`. Hoverbar: `TintEditor(..., label: "Tint")` (default `offersNoTint: true`).

2. **Met.** Hoverbar order is `TintChoice.ordered = [.none] + TintPreset.allCases.map { .preset($0) } + [.custom]` with presets `blue, purple, pink, red, orange, yellow, green, graphite`. Lil Nap uses `ordered(offersNoTint: false)`: same presets then custom, no none chip (owner deviation; graphite is the remaining neutral). Hoverbar still leads with no tint.

3. **Met.** Custom is `NSColorWell` (`colorWellStyle = .minimal`). `activate` sets `NSColorPanel.shared.showsAlpha = false` (panel eyedropper). Hex entry: `TextField("Hex color", text: draftBinding, prompt: Text(verbatim: "#RRGGBB"))`.

4. **Met.** `TintEditorModel` keeps `draft` apart from `committed`. `applyDraft` always stores `draft`.

5. **Met.** `applyDraft` does not clear `committed` or `isCustom`. Hex UI is `if model.isCustom`. Pinned by `emptyPartialAndInvalidDraftsKeepTheCommittedColor` (`""`, `"#"`, `"#3"`, `"#3311a"`, `"#zzzzzz"`).

6. **Met.** `committed` updates only via `TintHex.normalize`. Hoverbar no-tint: `select(.none)` sets `committed = nil`; `hoverBarStorage(fromCommitted: nil)` is nil (key omitted). Lil Nap has no no-tint chip; `sleepStorage(fromCommitted: nil)` is `#8e8e93`.

7. **Met.** None/preset chips are `Button`s with `.accessibilityLabel(choice.accessibilityLabel)`, `.accessibilityAddTraits(selected ? .isSelected : [])`, and chip-row `.focusSection()`. Custom well: `setAccessibilityLabel("Custom color")` and `setAccessibilitySelected(isSelected)`.

8. **Met.** `hoverBarNoTintRoundTripsAsOmittedKey` (omit `tint`, no JSON `null`). Preset/custom `#rrggbb` round-trip for hoverbar and sleep. `sleepNilCommitRoundTripsAsGraphiteHex`. `tintWritePreservesUnknownFieldsAndStableEncoding`. Additive path is `ConfigMerge.mergedJSONData`.

9. **Met.** `mac/Tests/LilChromiumTests/TintTests.swift` covers draft/commit boundaries and those config round trips.
