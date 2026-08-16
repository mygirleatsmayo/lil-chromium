# Issue #11 — Reuse one accessible tint editor

## What landed

One native tint control, `TintEditor`, used at both Settings call sites (Lil Nap and hoverbar). Draft/commit logic lives in `TintEditorModel` so tests do not instantiate SwiftUI views.

The Settings shell is unchanged: 440×520, `NSHostingController`, autosave name `LilChromiumSettings`.

## Criteria

1. **One component, two call sites.** `TintEditor` in `sleepControls` (`label: "Lil Nap tint"`) and `hoverbarSection` (`label: "Tint"`). Not two lookalikes.
2. **Choice order.** `TintChoice.ordered`: no tint; blue, purple, pink, red, orange, yellow, green, graphite; custom.
3. **Custom opens the native picker.** The last control is an `NSColorWell` (`.minimal`). Activating it opens `NSColorPanel` with `showsAlpha = false` (eyedropper on the panel; hex also in the panel’s RGB sliders). A hex `TextField` is the editor’s own hex draft.
4–6. **Draft ≠ committed.** `draft` is local. Empty / partial / invalid text stays in `draft` and does not change `committed` or collapse `isCustom`. Only `TintHex.normalize` (`#rgb` / `#rrggbb` → `#rrggbb`) writes a color. No-tint sets `committed = nil` (a chosen none, not a missing draft).
7. **Focus, label, selected.** Preset/none chips are `Button`s (keyboard focus). Custom is the color well (native focus). Each choice has an accessibility label and `.isSelected` when chosen. Hex field labeled “Hex color”.
8. **Config round trip.** Hoverbar none → omit `tint` (existing PROTOCOL optional `#rrggbb`). Preset/custom → `#rrggbb`. Lil Nap named `"purple"` / `"gray"` still decode and display as those chips; Settings does not rewrite them unless the user picks a different value. New Lil Nap commits are `#rrggbb`. Unknown top-level fields survive a tint write (existing `ConfigMerge` rule). Encoding stays sorted/pretty/stable.
9. **Tests.** `mac/Tests/LilChromiumTests/TintTests.swift` in the existing target: draft/commit boundaries, named-token mapping, hoverbar/sleep round trips, unknown-field preservation.

## PROTOCOL conflict (not guessed into `docs/PROTOCOL.md`)

`docs/PROTOCOL.md` says `sleep.tint` is `"gray" | "purple"` or `#rrggbb` — required, default `"purple"`. It has no no-tint token. Hoverbar none is already `nil` / omitted.

Lil Nap no-tint cannot omit the key (absent would decode as default purple) and cannot write JSON `null` (#3 forbids explicit nulls). The stand-in is an empty string: present, chosen, round-trips as none in the editor, does not become `"purple"`.

The extension still resolves a non-named, non-hex tint to purple (`extension/sleep.js`). That page is owned by later tickets; this work does not change it. Until then a stored Lil Nap none will not look untinted in a napping lil.

## Out of scope

- Hot-applying tints to live lils / relays (#12).
- Lil Nap page copy, capture, and overlay behavior (#20).
- Changing `docs/PROTOCOL.md` or the MV3 suite.
- Settings window size, placement, or autosave.
- A second test target or a second Settings surface.
