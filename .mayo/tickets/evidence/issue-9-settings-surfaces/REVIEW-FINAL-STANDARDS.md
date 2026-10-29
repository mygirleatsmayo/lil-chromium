# Final Standards review — issue #9

Fixed `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · head `5804d17218d00ab6b3766393c8681ec50d01f40a` (both resolve; diff non-empty). Ledger P1 settled (full-word `settings`/`preferences` only). Evidence Markdown is audit context only.

## Hard — documented standards

**AGENTS.md / PROTOCOL.md — contract lockstep (new after P1).** Palette matching in production and tests is exact equality after trim+lowercase (`SettingsAction.matchesQuery`). PROTOCOL still documents prefix discoverability:

```
Persistent gear control and a selectable Settings result (queries that prefix “settings” or “preferences”) both close the palette then present Settings; they never send `open`.
```

`AGENTS.md`: a contract change lands in all three components or none. The app no longer implements that sentence. Settled P1 is not wrong; the protocol text was not updated with the remediating commit. Not `needs adjudication`.

## Judgement — smell baseline

None with a concrete risk. Host `handleOpenSettings` still follows the existing `/usr/bin/open` `Process` shape.

## `/swiftui-pro`

No SwiftUI in this diff (gear is AppKit `NSButton`; `PaletteRowView` is `NSView`). Skill references not applied.

## `/swift-testing-pro`

Delta tests: struct suites, parameterized `@Test`, `#expect` / `#require`, `== false` not `!`, `.bug(id: 9)` on the P1 stub/Return cases. No findings.

## Checked, not filed

- Three-component `open-settings` / `lilchromium://settings` / `com.lilchromium.app` still aligned aside from the prefix sentence.
- New UI on existing `@MainActor` `PaletteController` / `AppDelegate`. `verified:` Return-chord comment untouched. `PaletteRowView` still lacks `@MainActor` (pre-existing).
- CONTEXT.md: native Settings, not avoided synonyms. Caret copy “Settings…”.
- `URLIntent.destination` classifies Settings first; gear/row/menu use `requestSettings()` and never `OpenRouter.open`.
