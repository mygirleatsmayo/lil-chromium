# Spec review — issue #9

Head `6cdf9d064931857cdea9405721492822e678e2ff` (brief had a leading `0`). Base `3c36c9a97d94e5ac9211b81c94e3ec72e226a558`. Spec: `gh issue view 9` (no comments), parent `gh issue view 2` (no comments), `CONTEXT.md`, `docs/PROTOCOL.md`.

## Medium — (b) unrequested prefixes; (c) they outrank Search

#9: “a selectable Settings result discoverable with both “settings” and “preferences.””

#2 ID 20: “an action row discoverable through “settings”/“preferences” search.”

#2 ID 21: “For non-empty, non-URL text, only a contiguous literal match in the registrable domain may outrank Search.”

`SettingsAction.matchesQuery` treats any case-insensitive prefix of “settings” with length ≥ 3 (`set`, `sett`, …) and of “preferences” with length ≥ 4 (`pref`, …) as a hit. `PaletteModel.rows` inserts that row at index 0, above Search and any eligible history. Tests lock it (`"set"`, `"sett"`, `"pref"`).

`set` + Return opens Settings, not Search and not an eligible registrable-domain row. The ticket named the full words; it did not ask those stubs to outrank Search.

## (a) Missing / partial

None of the eight #9 ACs are missing at the requested seams.

## Checked, no defect

Persistent gear and Settings row / menu / `lilchromium://settings` intake all call `requestSettings()` (close palette, then `SettingsWindowController.show()`). Caret “Settings…” posts `{action:"openSettings"}`; SW posts fixture `{"type":"open-settings"}`; host `open -b com.lilchromium.app lilchromium://settings` and does not forward. `URLIntent.destination` classifies that URL before `.open`. MV3 test: no `windows.create`, no focusing `windows.update`, no `open-external`. No duplicated global controls (CONTEXT “Global setting”; #2 ID 4 / out of scope). Fixture, native decode/URL/palette tests, MV3 worker test, PROTOCOL lockstep.
