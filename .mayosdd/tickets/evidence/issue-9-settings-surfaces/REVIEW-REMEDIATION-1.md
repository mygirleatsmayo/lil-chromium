# Remediation review 1 — issue #9

Pre-fix: `2b1f8253e8e5e3be3e8ca67cb3f06667e02d599e` · Head: `b8444e22dbee5897beeed2d96fa9402f609547a5` (matches task). Original/reviewed refs resolve. Delta non-empty: `SettingsAction.swift`, `PaletteTests.swift`, `REMEDIATION-1.md`.

## Ledger (fix)

### P1 — Spec — **resolved**

Settled: Settings may lead only for complete case-insensitive `settings` / `preferences`; stubs (`set`, `pref`, …) stay ordinary non-URL queries.

Production gate is now exact equality after trim + lowercase:

```swift
return text == "settings" || text == "preferences"
```

Prefix length gates (`settings` ≥ 3, `preferences` ≥ 4) removed. `PaletteModel.rows` still inserts `settingsRow()` at 0 iff `matchesQuery`.

Tests: full-word parameterized cases keep Settings-first + Search-below (preferences now includes `PREFERENCES` and the Search assertion). New `partialSettingsStubsStayOrdinaryNonURLQueries` (`.bug(id: 9)`, args `set`/`sett`/`pref`/`prefer`) asserts no Settings row and Search leads.

## New defects in the delta

None. Empty/`settings extra` still fail equality. Trim was pre-existing, not a new interpretation.

Swift Testing (delta only): struct suite, parameterized `@Test`, `#expect(... == false)` (no `!`), `.bug(id: 9)` — no issues.

## Outcome

P1 resolved. No unresolved/regressed items. No `needs adjudication`. No further remediation.
