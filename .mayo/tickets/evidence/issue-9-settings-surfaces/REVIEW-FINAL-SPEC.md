# Final Spec review — issue #9

Fixed point `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · Head `5804d17218d00ab6b3766393c8681ec50d01f40a`. Sources: `gh issue view 9` / `2` (no comments), `CONTEXT.md`, `docs/PROTOCOL.md`, ledger P1, `REVIEW-REMEDIATION-1.md`.

## Medium — PROTOCOL still specifies prefix ranking (P1 leftover)

Ledger P1 (settled, **fix**): “The dedicated Settings row may lead for the complete case-insensitive queries `settings` and `preferences`. Partial stubs such as `set` and `pref` remain ordinary non-URL palette queries; parent #2 ordering rule 21 allows only a registrable-domain literal to outrank Search otherwise.”

#9: “a selectable Settings result discoverable with both “settings” and “preferences.””

#2 ID 21: “For non-empty, non-URL text, only a contiguous literal match in the registrable domain may outrank Search.”

#2 ID 51: “Any new … Settings command … lands atomically in the native app, host, extension, and protocol documentation.”

#9 AC: “Shared fixtures, native tests, MV3 tests, and protocol documentation cover the command end to end.”

`SettingsAction.matchesQuery` is exact equality after trim+lowercase (`text == "settings" || text == "preferences"`). Tests lock stubs as ordinary Search-first queries. PROTOCOL.md still says:

> Persistent gear control and a selectable Settings result (queries that prefix “settings” or “preferences”) both close the palette then present Settings; they never send `open`.

That sentence is the pre-P1 ranking rule. Production matches the settlement; the contract still documents unrequested prefix hits that would outrank Search. Lockstep for this ticket is incomplete.

## Ledger

P1 production/tests: **resolved** (matches `REVIEW-REMEDIATION-1.md`). Not re-failed.

## (a) Missing / partial

No #9 AC missing at the requested seams except the protocol prefix sentence above.

## Checked, no defect

Gear + Settings row / menu / URL intake all `requestSettings()` (close, then singleton). Caret “Settings…” → `{action:"openSettings"}` → fixture `{"type":"open-settings"}`; host `open -b com.lilchromium.app lilchromium://settings`, not forwarded, not a browser. `URLIntent.destination` classifies before `.open`. MV3: no `windows.create`, no focusing `windows.update`, no `open-external`. No duplicated global controls (#2 ID 4; CONTEXT “Global setting”). Shared fixture + native decode/URL/palette tests + worker test. No `needs adjudication`.
