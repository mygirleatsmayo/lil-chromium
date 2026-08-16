import Foundation

/// One search provider offered in Settings. `template == nil` is the Custom
/// sentinel: the user supplies their own template, and selection is never
/// inferred by matching that template against a preset.
public struct SearchProvider: Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let template: String?

    public var isCustom: Bool { template == nil }

    public init(id: String, name: String, template: String?) {
        self.id = id
        self.name = name
        self.template = template
    }
}

/// Built-in search providers. Display names stay as written; ids are the
/// explicit stored `searchEngine.provider` values.
public enum SearchProviders {

    public static let google = SearchProvider(
        id: "google",
        name: "Google",
        template: "https://www.google.com/search?q=%s"
    )
    public static let duckDuckGo = SearchProvider(
        id: "ddg",
        name: "DuckDuckGo",
        template: "https://duckduckgo.com/?q=%s"
    )
    public static let bing = SearchProvider(
        id: "bing",
        name: "Bing",
        template: "https://www.bing.com/search?q=%s"
    )
    public static let kagi = SearchProvider(
        id: "kagi",
        name: "Kagi",
        template: "https://kagi.com/search?q=%s"
    )
    /// Startpage's documented search-string URL (support.startpage.com).
    public static let startpageTemplate = "https://www.startpage.com/sp/search?query=%s"

    public static let startpage = SearchProvider(
        id: "startpage",
        name: "Startpage",
        template: startpageTemplate
    )
    public static let custom = SearchProvider(
        id: "custom",
        name: "Custom",
        template: nil
    )

    /// Settings order: Google, DuckDuckGo, Bing, Kagi, Startpage, Custom.
    public static let all: [SearchProvider] = [
        google, duckDuckGo, bing, kagi, startpage, custom,
    ]

    public static func preset(id: String) -> SearchProvider? {
        all.first { $0.id == id }
    }

    public static func isKnown(_ id: String) -> Bool {
        preset(id: id) != nil
    }

    /// Map a stored display `name` onto a provider id. Used only when `provider`
    /// is missing from an existing file — never by matching `template`.
    public static func idMatching(name: String) -> String {
        all.first { $0.name == name }?.id ?? custom.id
    }

    /// The id Settings should select. An explicit stored `provider` wins when it
    /// is a known id; otherwise the stored `name` is the existing explicit
    /// identity. The current template is never consulted.
    public static func resolvedID(provider: String, name: String) -> String {
        if isKnown(provider) { return provider }
        return idMatching(name: name)
    }
}

/// Settings editing state for search: the committed `SearchEngineConfig` plus a
/// Custom draft that is allowed to be partial or invalid without changing the
/// selected provider or the last committed template.
public struct SearchEngineEditor: Equatable, Sendable {
    public var config: SearchEngineConfig
    public var customDraft: String

    public init(config: SearchEngineConfig, customDraft: String? = nil) {
        self.config = config
        if let customDraft {
            self.customDraft = customDraft
        } else if SearchProviders.resolvedID(provider: config.provider, name: config.name)
                    == SearchProviders.custom.id {
            self.customDraft = config.template
        } else {
            self.customDraft = ""
        }
    }

    public var selectedProviderID: String {
        SearchProviders.resolvedID(provider: config.provider, name: config.name)
    }

    public var showsCustomField: Bool {
        selectedProviderID == SearchProviders.custom.id
    }

    /// True when the Custom field is showing a draft that cannot be committed.
    public var showsInvalidDraftExplanation: Bool {
        showsCustomField && !Self.isCommitable(customDraft)
    }

    /// A Custom draft commits only when it contains a `%s` placeholder.
    public static func isCommitable(_ draft: String) -> Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines).contains("%s")
    }

    /// Select a Settings preset. Custom keeps the last committed template and
    /// does not overwrite a draft the user is still typing. Presets write their
    /// own name+template and leave the draft alone.
    public mutating func selectProvider(_ id: String) {
        guard let preset = SearchProviders.preset(id: id) else { return }
        config.provider = preset.id
        config.name = preset.name
        if let template = preset.template {
            config.template = template
            return
        }
        if customDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            customDraft = config.template
        }
    }

    /// Replace the Custom draft. The committed template updates only when the
    /// draft contains `%s`; an invalid draft stays visible and is not written.
    public mutating func updateCustomDraft(_ text: String) {
        customDraft = text
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("%s") else { return }
        config.template = trimmed
    }
}
