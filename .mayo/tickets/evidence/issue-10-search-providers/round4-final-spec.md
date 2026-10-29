# Final spec review — Issue #10

No findings.

PROTOCOL.md / README.md edits are accurate and minimal (Startpage default, `provider` on the wire, presets include Startpage, hover-bar search uses `searchEngine.template`).

## Criteria

1. **Met.** Fresh or missing config → Startpage; a named existing file stays that engine. Defaults: `name: String = SearchProviders.startpage.name`, `template: String = SearchProviders.startpageTemplate`. Decode: missing `searchEngine` is `?? d.searchEngine`; missing `provider` is `idMatching(name:)`, never template. Extension `DEFAULT_SEARCH` and overlay fallback are Startpage. PROTOCOL example + “Missing file/fields → built-in defaults above” are Startpage. Tests: `missingSearchEngineDefaultsToStartpage`, `existingNamedProviderStaysExplicit`.

2. **Met.** `SearchProviders.all` = Google, DuckDuckGo, Bing, Kagi, Startpage, Custom. Settings: `ForEach(SearchProviders.all)`. PROTOCOL presets match. README lists the same engines.

3. **Met.** Stored `SearchEngineConfig.provider`. Picker `get: { editor.selectedProviderID }` (`resolvedID(provider:name)`). Old `searchPresets.first(where: { $0.template == tmpl })` is gone. Test: `storedProviderIsNotInferredFromTemplate`.

4. **Met.** `selectProvider("custom")` writes `provider`/`name` Custom and keeps the committed template; `showsCustomField` shows the `TextField`. Test: `selectingCustomStaysCustomWithFieldVisible`.

5. **Met.** `customDraft` is editor state, not the committed template. `updateCustomDraft` does not change `provider` or `config.template` without `%s`; caption via `showsInvalidDraftExplanation`. Test: `invalidCustomDraftStaysVisibleAndDoesNotCommit`.

6. **Met.** `guard trimmed.contains("%s") else { return }` then `config.template = trimmed`. Test: `validCustomDraftCommitsTheTemplate`.

7. **Met.** Palette: `searchEngine.searchURL(for:)` percent-encodes and substitutes `%s`. Hoverbar: `template.replace("%s", encodeURIComponent(raw))` from `ctx.searchEngine.template` else `DEFAULT_SEARCH`. PROTOCOL hover-bar line matches. Test: `validTemplatesSubstituteTheEncodedQuery`.

8. **Met.** Custom is a standard `TextField`. Paste stays the existing nil-targeted Edit menu. No custom paste path.

9. **Met.** `SearchProviderTests` covers defaults, existing config, presets, invalid drafts, and substitution. `ConfigTests`, `URLIntentTests`, and the extension v1-fixture assertion follow Startpage.
