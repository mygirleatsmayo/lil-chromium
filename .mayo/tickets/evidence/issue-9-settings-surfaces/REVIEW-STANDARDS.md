# Standards review — issue #9 (`3c36c9a9…6cdf9d06`)

Axis: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md` + Fowler ch.3 baseline (judgement). Skills: `/swiftui-pro` (SwiftUI hunks only), `/swift-testing-pro`. Read-only `git diff 3c36c9a97d94e5ac9211b81c94e3ec72e226a558...HEAD` (1 commit: `6cdf9d06`). Not a spec review.

## Hard — documented standards

None.

## Judgement — baseline smells

None with a concrete risk. `handleOpenSettings` copies the existing `/usr/bin/open` `Process` block from `handleOpenExternal`; that is the host’s established launch shape, not a new abstraction.

## `/swiftui-pro`

No SwiftUI in this diff. `PaletteRowView` is AppKit `NSView` (one new `.settings` / `gearshape` case). The palette gear is `NSButton`, not a SwiftUI `Button`.

## `/swift-testing-pro`

`MessageTests.openSettingsIsTypeOnly`, `PaletteSettingsAccessTests`, `PaletteActionTests` Settings cases, `SettingsActionTests`: structs, `#expect` / `#require`, parameterized cases, `== false` not `!`, `.bug(id: 9)` on the Return tests, no XCTest. Discoverability tests use `rows.first?` like the rest of `PaletteTests.swift`. No findings.

## Checked, not filed

1. **AGENTS.md — three-component contract.** PROTOCOL, `OpenSettingsMessage` + `fixtures/message-open-settings.json`, host `handleOpenSettings`, extension `openSettings` / caret “Settings…”, app intake + palette gear/row, `bundle-app.sh` `lilchromium` scheme. Extension ID and native-host name unchanged; app bundle id is now pinned.
2. **AGENTS.md — `@MainActor` / `verified:`.** New UI is on existing `@MainActor` `PaletteController` / `AppDelegate`. No new AppKit type. Return-chord `verified:` comment unchanged. PaletteRowView still lacks `@MainActor` (pre-existing).
3. **AGENTS.md — prose.** README / CHANGELOG not in the diff. PROTOCOL edits are required contract text. Caret copy is “Settings…”.
4. **PROTOCOL.md.** Type-only `open-settings` is not forwarded; host launches `open -b` via `SettingsAction`; intake classifies `lilchromium://settings` before `OpenRouter`; gear and Settings row call `requestSettings()` (close, then singleton) and never `OpenRouter.open`.
5. **CONTEXT.md.** No avoided synonyms (popup, default browser, extension setting, connected browser). Native Settings, not duplicated global controls.
6. **Baseline.** Required three-component edits are not Shotgun Surgery. `SettingsAction` bundles URL + bundle id (`openArguments`). `matchesQuery` sits on the dedicated action type. `URLIntent.destination` is a classifier, not a Middle Man. Cross-language `open-settings` is the contract.
