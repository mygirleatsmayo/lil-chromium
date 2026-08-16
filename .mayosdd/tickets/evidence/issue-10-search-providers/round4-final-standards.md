# Standards review

No findings.

`git diff main...HEAD` meets `AGENTS.md`, `docs/PROTOCOL.md`, `CONTEXT.md` / `docs/adr/`, and the frozen Issue #10 ledger. Owner Startpage default is not re-argued. PROTOCOL.md / README.md edits are accurate and minimal.

## Three-component contract

Startpage as missing-config default landed in all three:

- `mac/`: `SearchEngineConfig.defaults`, `searchURL(for:)` fallback
- `extension/`: `DEFAULT_SEARCH`, overlay fallbacks
- `docs/PROTOCOL.md`: example + “missing file/fields → built-in defaults above”; hover-bar copy uses `searchEngine.template`

`provider` landed in `mac/` (`SearchEngineConfig`) and PROTOCOL (`google|ddg|bing|kagi|startpage|custom`; never inferred from `template`). Extension still copies `name`/`template` only. That matches ADR-0001 (Settings stay native) and the hover-bar contract (omnibox uses `template`). Host `ContextMessage` already encodes the full Codable object.

## Remaining Google (not live defaults)

- Presets: `SearchProviders.google`, PROTOCOL/README lists — correct.
- Existing fixtures that name Google stay Google.
- `URLIntent.googleSearchURL` still hardcodes Google but is uncalled; palette/hoverbar use `searchURL(for:)` / `template`. Not a live default.

## Checked, not filed

Ledger settled interpretations (explicit `provider`; Custom draft ≠ committed template) hold. `SettingsSearchControls` `@State` editor does not re-seed on `reloadToken` so a whitelist reload cannot clobber a draft. Pre-existing `ObservableObject` / `Binding(get:set:)` / multi-type Settings file: repo-endorsed, not smells. New SwiftUI uses `foregroundStyle`, labeled `Picker`. No new AppKit type without `@MainActor`. No `verified:` drift.
