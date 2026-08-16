import Foundation
import Testing
@testable import LilShared

/// Search-provider selection: explicit stored state, Startpage as the missing
/// default, and a Custom draft that is not the committed template.
struct SearchProviderTests {

    // MARK: - Defaults (criterion 1)

    /// A brand-new config, and a file that never had `searchEngine`, both land
    /// on Startpage. An existing name+template is a different path (below).
    @Test func missingSearchEngineDefaultsToStartpage() throws {
        #expect(SearchEngineConfig.defaults.provider == "startpage")
        #expect(SearchEngineConfig.defaults.name == "Startpage")
        #expect(SearchEngineConfig.defaults.template == SearchProviders.startpageTemplate)

        let legacy = try Fixture.decode(LilConfig.self, from: "config-v1-legacy")
        #expect(legacy.searchEngine.provider == "startpage")
        #expect(legacy.searchEngine.name == "Startpage")
        #expect(legacy.searchEngine.template == SearchProviders.startpageTemplate)
    }

    @Test func settingsOffersTheSixProvidersInOrder() {
        #expect(SearchProviders.all.map(\.name) == [
            "Google", "DuckDuckGo", "Bing", "Kagi", "Startpage", "Custom",
        ])
        #expect(SearchProviders.all.map(\.id) == [
            "google", "ddg", "bing", "kagi", "startpage", "custom",
        ])
    }

    /// Encoding now writes `provider` inside `searchEngine`. That must not
    /// disturb the unknown-field preservation the #3 suite pins.
    @Test func encodingProviderPreservesUnknownTopLevelFields() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let cfg = try JSONDecoder().decode(LilConfig.self, from: existing)
        let merged = try #require(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let out = try jsonObject(merged)

        let probe = try #require(out["unknownSectionProbe"] as? [String: Any])
        #expect(probe["someNumber"] as? Int == 24)
        #expect(probe["someFlag"] as? Bool == true)

        let engine = try #require(out["searchEngine"] as? [String: Any])
        #expect(engine["provider"] as? String == "google")
        #expect(engine["name"] as? String == "Google")
        #expect(engine["template"] as? String == "https://www.google.com/search?q=%s")
    }

    // MARK: - Explicit existing config (criterion 1, 3)

    /// A v2 file that named Kagi keeps Kagi. The missing `provider` key is
    /// recovered from `name`, never by pattern-matching the template.
    @Test func existingNamedProviderStaysExplicit() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")

        #expect(cfg.searchEngine.name == "Kagi")
        #expect(cfg.searchEngine.provider == "kagi")
        #expect(cfg.searchEngine.template == "https://kagi.com/search?q=%s")
        #expect(
            SearchProviders.resolvedID(provider: cfg.searchEngine.provider, name: cfg.searchEngine.name)
                == "kagi"
        )
    }

    /// An explicit `provider` wins even when the template belongs to someone else.
    @Test func storedProviderIsNotInferredFromTemplate() throws {
        let json = Data(#"""
        {"name":"Google","provider":"google","template":"https://kagi.com/search?q=%s"}
        """#.utf8)
        let cfg = try JSONDecoder().decode(SearchEngineConfig.self, from: json)

        #expect(cfg.provider == "google")
        #expect(cfg.name == "Google")
        #expect(cfg.template == "https://kagi.com/search?q=%s")
        #expect(SearchProviders.resolvedID(provider: cfg.provider, name: cfg.name) == "google")
    }

    /// Encoding a decoded existing file writes the inferred provider without
    /// rewriting name or template — additive, not a silent engine change.
    @Test func encodingExistingConfigWritesInferredProvider() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")
        let obj = try jsonObject(JSONEncoder().encode(cfg.searchEngine))

        #expect(obj["provider"] as? String == "kagi")
        #expect(obj["name"] as? String == "Kagi")
        #expect(obj["template"] as? String == "https://kagi.com/search?q=%s")
    }

    // MARK: - Preset changes (criterion 3, 4)

    @Test(arguments: ["google", "ddg", "bing", "kagi", "startpage"])
    func selectingAPresetWritesItsNameAndTemplate(id: String) throws {
        let preset = try #require(SearchProviders.preset(id: id))
        let presetTemplate = try #require(preset.template)
        var editor = SearchEngineEditor(config: .defaults)

        editor.selectProvider(id)

        #expect(editor.config.provider == id)
        #expect(editor.config.name == preset.name)
        #expect(editor.config.template == presetTemplate)
        #expect(editor.selectedProviderID == id)
        #expect(editor.showsCustomField == false)
    }

    /// Selecting Custom is stored as Custom even when the committed template
    /// still matches a preset — the bug that snapped the picker back.
    @Test func selectingCustomStaysCustomWithFieldVisible() {
        var editor = SearchEngineEditor(config: .defaults)
        let previousTemplate = editor.config.template

        editor.selectProvider("custom")

        #expect(editor.config.provider == "custom")
        #expect(editor.config.name == "Custom")
        #expect(editor.config.template == previousTemplate)
        #expect(editor.selectedProviderID == "custom")
        #expect(editor.showsCustomField)
        #expect(editor.customDraft == previousTemplate)
    }

    // MARK: - Invalid drafts (criterion 4, 5, 6)

    @Test func invalidCustomDraftStaysVisibleAndDoesNotCommit() {
        var editor = SearchEngineEditor(config: .defaults)
        editor.selectProvider("custom")
        let committed = editor.config.template

        editor.updateCustomDraft("https://example.com/search?q=")

        #expect(editor.config.provider == "custom")
        #expect(editor.selectedProviderID == "custom")
        #expect(editor.showsCustomField)
        #expect(editor.showsInvalidDraftExplanation)
        #expect(editor.customDraft == "https://example.com/search?q=")
        #expect(editor.config.template == committed, "last good template is kept")
    }

    /// Switching to a preset and back must not clobber a draft still being typed.
    @Test func switchingPresetsDoesNotOverwriteACustomDraft() throws {
        var editor = SearchEngineEditor(config: .defaults)
        editor.selectProvider("custom")
        editor.updateCustomDraft("https://example.com/q=")

        editor.selectProvider("google")
        #expect(editor.config.provider == "google")
        #expect(editor.customDraft == "https://example.com/q=")

        editor.selectProvider("custom")
        #expect(editor.config.provider == "custom")
        #expect(editor.customDraft == "https://example.com/q=")
        #expect(editor.showsCustomField)
        #expect(editor.showsInvalidDraftExplanation)
        let googleTemplate = try #require(SearchProviders.google.template)
        #expect(editor.config.template == googleTemplate)
    }

    @Test func validCustomDraftCommitsTheTemplate() {
        var editor = SearchEngineEditor(config: .defaults)
        editor.selectProvider("custom")

        editor.updateCustomDraft("https://example.com/search?q=%s")

        #expect(editor.config.provider == "custom")
        #expect(editor.config.name == "Custom")
        #expect(editor.config.template == "https://example.com/search?q=%s")
        #expect(editor.showsInvalidDraftExplanation == false)
    }

    // MARK: - Valid substitution (criterion 7, 9)

    @Test func validTemplatesSubstituteTheEncodedQuery() {
        #expect(
            SearchEngineConfig.defaults.searchURL(for: "lil chromium")
                == "https://www.startpage.com/sp/search?query=lil%20chromium"
        )

        let kagi = SearchEngineConfig(
            name: "Kagi",
            template: "https://kagi.com/search?q=%s",
            provider: "kagi"
        )
        #expect(kagi.searchURL(for: "café") == "https://kagi.com/search?q=caf%C3%A9")

        var editor = SearchEngineEditor(config: .defaults)
        editor.selectProvider("custom")
        editor.updateCustomDraft("https://example.com/find?q=%s")
        #expect(
            editor.config.searchURL(for: "swift 6")
                == "https://example.com/find?q=swift%206"
        )
    }
}
