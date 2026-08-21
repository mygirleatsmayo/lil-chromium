# Remediation round 1 — issue #9

Branch: `surfx/remediate-issue-9-round-1-outcome-resolv-PSxbdvoZ`
Fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558`
Reviewed: `6cdf9d064931857cdea9405721492822e678e2ff`
Ledger / pre-fix: `2b1f8253e8e5e3be3e8ca67cb3f06667e02d599e`

One Spec finding (P1). No Standards findings. Ledger and first-review reports untouched.

## P1 — Settings leads only for complete `settings` / `preferences`

Settled: the dedicated Settings row may lead for the complete case-insensitive queries `settings` and `preferences`. Partial stubs such as `set` and `pref` remain ordinary non-URL palette queries; parent #2 ordering rule 21 allows only a registrable-domain literal to outrank Search otherwise.

### Diff

`SettingsAction.matchesQuery` (`mac/Sources/LilShared/SettingsAction.swift`) now matches trimmed, lowercased equality to `"settings"` or `"preferences"`. Prefix length gates (`settings` ≥ 3, `preferences` ≥ 4) are gone.

`PaletteModel.rows` is unchanged: it still inserts `settingsRow()` at index 0 when `matchesQuery` is true. Gear, URL intent, result actions, and `requestSettings()` were not touched.

### Tests (TDD)

Seam: `PaletteModel.rows` (discoverability and order). `matchesQuery` is the production gate those rows use.

1. **Red:** `PaletteSettingsAccessTests` no longer parameterized `"set"` / `"sett"` / `"pref"` / `"prefer"` as Settings-leading queries. New `partialSettingsStubsStayOrdinaryNonURLQueries` (`.bug(id: 9)`) asserts those stubs offer no Settings row and lead with Search.

   Command: `swift test --filter PaletteSettingsAccessTests` in `mac/`

   Result: 8 issues. Every stub had `rows.contains { $0.kind == .settings } → true` and `rows.first?.kind → .settings` (expected `.search`). Full-word cases already passed.

2. **Green:** same filter after the `matchesQuery` equality change. 4 tests / 16 cases passed.

Full-word case variants still lead with Settings, Search below. Return / ⌘-Return on those rows still request native Settings (`PaletteActionTests`). Unrelated queries still omit Settings.

## Verification

| Command | Result |
|---|---|
| `swift test --filter PaletteSettingsAccessTests` (red) | 1 test / 4 cases failed (8 issues) |
| `swift test --filter PaletteSettingsAccessTests` (green) | 4 tests passed |
| `pnpm test` | 39 pass, 0 fail |
| `swift test` in `mac/` | 153 tests in 15 suites passed |
| `make app` | built `mac/build/LilChromium.app` (no install) |
| `git diff --check` | clean |

Live app / browser / extension / native host were not installed, launched, reloaded, or quit.
