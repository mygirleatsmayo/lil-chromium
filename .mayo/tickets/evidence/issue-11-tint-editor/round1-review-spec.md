# Spec review — Issue #11

- **P1** Criterion 8 — **partially met**. Native additive decode round-trips hoverbar none (omit `tint`), preset/custom `#rrggbb`, and Lil Nap none as `""` (`sleepNoTintRoundTripsWithoutBecomingDefaultPurple`, `hoverBarNoTintRoundTripsAsOmittedKey`). Future Lil Nap pages still paint purple: `sleepStorage(fromCommitted: nil)` is `""`; `background.js` `const tint = ctx.sleep && ctx.sleep.tint ? ctx.sleep.tint : "purple"` and `sleep.js` `params.get("tint") || "purple"` / `resolveTint` `return NAMED.purple` treat empty as purple. Diff does not touch `extension/`. Hoverbar none/hex still apply (`overlay.js` `/^#([0-9a-f]{3}|[0-9a-f]{6})$/i`); Lil Nap hex would via `hexToRgb`.
- Criterion 1 — **met**. One `TintEditor` at `sleepControls` (`label: "Lil Nap tint"`) and `hoverbarSection` (`label: "Tint"`).
- Criterion 2 — **met**. `TintChoice.ordered = [.none] + TintPreset.allCases.map { .preset($0) } + [.custom]` with `case blue, purple, pink, red, orange, yellow, green, graphite`.
- Criterion 3 — **met**. Custom is `NSColorWell` `colorWellStyle = .minimal`; `activate` sets `NSColorPanel.shared.showsAlpha = false`; hex field is `TextField("Hex color", ...)`.
- Criterion 4 — **met**. `TintEditorModel` keeps `draft` apart from `committed`.
- Criterion 5 — **met**. `applyDraft` keeps `draft`/`isCustom` and does not clear `committed`; hex UI is `if model.isCustom`.
- Criterion 6 — **met**. Only `TintHex.normalize` commits; `select(.none)` sets `committed = nil` (hoverbar omit; sleep `""`).
- Criterion 7 — **met**. None/preset chips are `Button`s with `accessibilityLabel` and `.isSelected`; custom well `setAccessibilityLabel("Custom color")` / `setAccessibilitySelected`.
- Criterion 9 — **met**. `mac/Tests/LilChromiumTests/TintTests.swift` covers draft/commit boundaries and ConfigMerge round trips.
