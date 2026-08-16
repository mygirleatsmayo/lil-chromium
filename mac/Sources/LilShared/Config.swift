import Foundation

// User configuration shared by the app and the hosts. Written by the app
// (Settings window / menu) AND by each host (whitelist-op merges); read fresh by
// each host on every `get-context`. Stored at ~/.lilchromium/config.json.
// See docs/PROTOCOL.md (Config file).
//
// Decoding is deliberately defensive: any missing field falls back to its
// per-field default, and any hard decode failure (corrupt JSON, wrong types
// at the top level) yields `.defaults` rather than throwing. Config is never
// load-bearing enough to justify crashing a menu-bar agent or a relay host.
//
// Schema version 2 (v0.3): adds ephemeralDefault, sleep, searchEngine, and
// hoverBar. The linkBehavior default flips to "new-lil".
//
// CRITICAL — unknown-field preservation: plain Codable round-trips DROP any
// JSON key not declared on the struct. The v3 contract requires all writers
// (app AND host) to PRESERVE unknown fields. `save()` therefore never encodes
// the whole struct over the file: it reads the current JSON object, merges only
// the top-level keys this struct owns (nested objects are replaced whole), and
// atomically rewrites. See ConfigMerge.swift for the merge machinery.

/// One browser the app has discovered (or that appears in config). Treated as
/// read-only truth by hosts and the extension.
public struct KnownBrowser: Codable, Sendable {
    public let slug: String
    public let name: String
    public let bundleId: String
    public let installed: Bool

    public init(slug: String, name: String, bundleId: String, installed: Bool) {
        self.slug = slug
        self.name = name
        self.bundleId = bundleId
        self.installed = installed
    }

    // Defensive decode: a single malformed entry (missing name/bundleId/
    // installed) degrades to blanks/false rather than failing the whole array.
    // `slug` is the only truly required field.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.slug = (try? c.decode(String.self, forKey: .slug)) ?? ""
        self.name = (try? c.decode(String.self, forKey: .name)) ?? ""
        self.bundleId = (try? c.decode(String.self, forKey: .bundleId)) ?? ""
        self.installed = (try? c.decode(Bool.self, forKey: .installed)) ?? false
    }
}

// MARK: - v2 nested config objects

/// Resource-saver ("sleep") configuration. See PROTOCOL.md `sleep`.
public struct SleepConfig: Codable, Sendable {
    public var enabled: Bool
    public var afterMinutes: Int
    public var audioGuard: Bool
    public var formGuard: Bool
    public var tint: String        // "gray" | "purple" | "#rrggbb"
    public var whitelist: [String] // domains never auto-slept (lowercased hosts)

    public init(
        enabled: Bool = false,
        afterMinutes: Int = 30,
        audioGuard: Bool = true,
        formGuard: Bool = true,
        tint: String = "purple",
        whitelist: [String] = []
    ) {
        self.enabled = enabled
        self.afterMinutes = afterMinutes
        self.audioGuard = audioGuard
        self.formGuard = formGuard
        self.tint = tint
        self.whitelist = whitelist
    }

    public static let defaults = SleepConfig()

    // Per-field defensive decode over `.defaults`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = SleepConfig.defaults
        self.enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? d.enabled
        self.afterMinutes = (try? c.decode(Int.self, forKey: .afterMinutes)) ?? d.afterMinutes
        self.audioGuard = (try? c.decode(Bool.self, forKey: .audioGuard)) ?? d.audioGuard
        self.formGuard = (try? c.decode(Bool.self, forKey: .formGuard)) ?? d.formGuard
        self.tint = (try? c.decode(String.self, forKey: .tint)) ?? d.tint
        self.whitelist = (try? c.decode([String].self, forKey: .whitelist)) ?? d.whitelist
    }
}

/// Search engine used by BOTH the palette and the lil hover-bar omnibox.
/// See PROTOCOL.md `searchEngine`. `provider` is the explicit Settings
/// selection; `name`/`template` are what palette and hoverbar consume.
public struct SearchEngineConfig: Codable, Equatable, Sendable {
    public var name: String
    public var template: String   // contains "%s" when committed
    /// Explicit Settings selection (`google`, `ddg`, `bing`, `kagi`,
    /// `startpage`, `custom`). Never inferred from `template`.
    public var provider: String

    private enum CodingKeys: String, CodingKey {
        case name, template, provider
    }

    public init(
        name: String = SearchProviders.startpage.name,
        template: String = SearchProviders.startpageTemplate,
        provider: String? = nil
    ) {
        self.name = name
        self.template = template
        if let provider, !provider.isEmpty {
            self.provider = provider
        } else {
            self.provider = SearchProviders.idMatching(name: name)
        }
    }

    public static let defaults = SearchEngineConfig()

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = SearchEngineConfig.defaults
        self.name = (try? c.decode(String.self, forKey: .name)) ?? d.name
        self.template = (try? c.decode(String.self, forKey: .template)) ?? d.template
        // Missing `provider` on an existing file: the stored `name` is the
        // explicit identity. Never recover selection by matching `template`.
        if let stored = try? c.decode(String.self, forKey: .provider), !stored.isEmpty {
            self.provider = stored
        } else {
            self.provider = SearchProviders.idMatching(name: self.name)
        }
    }

    /// Build a search URL for `query`, percent-encoding the query and
    /// substituting it for the first `%s`. Falls back to the default (Startpage)
    /// template if this one has no `%s`. Used by the palette and (mirrored)
    /// the extension.
    public func searchURL(for query: String) -> String {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let encoded = trimmed.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) ?? trimmed
        let tmpl = template.contains("%s") ? template : SearchEngineConfig.defaults.template
        return tmpl.replacingOccurrences(of: "%s", with: encoded)
    }
}

/// Hover-bar appearance. See PROTOCOL.md `hoverBar`.
public struct HoverBarConfig: Codable, Sendable {
    public var style: String     // "glass" | "solid"
    public var tint: String?     // optional "#rrggbb"

    // Explicit CodingKeys: both init(from:) and encode(to:) are custom.
    private enum CodingKeys: String, CodingKey {
        case style, tint
    }

    public init(style: String = "glass", tint: String? = nil) {
        self.style = style
        self.tint = tint
    }

    public static let defaults = HoverBarConfig()

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = HoverBarConfig.defaults
        self.style = (try? c.decode(String.self, forKey: .style)) ?? d.style
        // tint is nullable: absent OR explicit null both decode to nil.
        self.tint = (try? c.decodeIfPresent(String.self, forKey: .tint)) ?? d.tint
    }

    // Encode tint only when present so we never emit an explicit `null`.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(style, forKey: .style)
        try c.encodeIfPresent(tint, forKey: .tint)
    }
}

/// The full user config.
public struct LilConfig: Codable, Sendable {
    public var version: Int
    public var defaultBrowser: String   // slug
    public var fallbackBrowser: String  // slug
    public var paletteAnchor: String    // "top-center" | "top-right"
    public var linkBehavior: String     // "same-lil" | "new-lil"
    public var ephemeralDefault: String // "never" | "6h" | "12h" | "24h" | "quit"
    public var sleep: SleepConfig
    public var searchEngine: SearchEngineConfig
    public var hoverBar: HoverBarConfig
    public var knownBrowsers: [KnownBrowser]

    public init(
        version: Int,
        defaultBrowser: String,
        fallbackBrowser: String,
        paletteAnchor: String,
        linkBehavior: String,
        ephemeralDefault: String,
        sleep: SleepConfig,
        searchEngine: SearchEngineConfig,
        hoverBar: HoverBarConfig,
        knownBrowsers: [KnownBrowser]
    ) {
        self.version = version
        self.defaultBrowser = defaultBrowser
        self.fallbackBrowser = fallbackBrowser
        self.paletteAnchor = paletteAnchor
        self.linkBehavior = linkBehavior
        self.ephemeralDefault = ephemeralDefault
        self.sleep = sleep
        self.searchEngine = searchEngine
        self.hoverBar = hoverBar
        self.knownBrowsers = knownBrowsers
    }

    /// Built-in defaults (schema v2): helium / chrome / top-center / new-lil /
    /// never / sleep-off / Startpage / glass / [].
    public static let defaults = LilConfig(
        version: 2,
        defaultBrowser: "helium",
        fallbackBrowser: "chrome",
        paletteAnchor: "top-center",
        linkBehavior: "new-lil",
        ephemeralDefault: "never",
        sleep: .defaults,
        searchEngine: .defaults,
        hoverBar: .defaults,
        knownBrowsers: []
    )

    // Decode into optionals, then merge each field over `.defaults`. Any field
    // absent or of the wrong type falls back individually; a top-level failure
    // is handled by `load()` returning `.defaults`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = LilConfig.defaults
        self.version = (try? c.decode(Int.self, forKey: .version)) ?? d.version
        self.defaultBrowser = (try? c.decode(String.self, forKey: .defaultBrowser)) ?? d.defaultBrowser
        self.fallbackBrowser = (try? c.decode(String.self, forKey: .fallbackBrowser)) ?? d.fallbackBrowser
        self.paletteAnchor = (try? c.decode(String.self, forKey: .paletteAnchor)) ?? d.paletteAnchor
        self.linkBehavior = (try? c.decode(String.self, forKey: .linkBehavior)) ?? d.linkBehavior
        self.ephemeralDefault = (try? c.decode(String.self, forKey: .ephemeralDefault)) ?? d.ephemeralDefault
        self.sleep = (try? c.decode(SleepConfig.self, forKey: .sleep)) ?? d.sleep
        self.searchEngine = (try? c.decode(SearchEngineConfig.self, forKey: .searchEngine)) ?? d.searchEngine
        self.hoverBar = (try? c.decode(HoverBarConfig.self, forKey: .hoverBar)) ?? d.hoverBar
        self.knownBrowsers = (try? c.decode([KnownBrowser].self, forKey: .knownBrowsers)) ?? d.knownBrowsers
    }

    // MARK: - Location

    /// `~/.lilchromium/config.json`.
    public static var fileURL: URL {
        LilPaths.stateDir.appendingPathComponent("config.json", isDirectory: false)
    }

    /// True if config.json is present on disk (used for first-run onboarding).
    public static var fileExists: Bool {
        FileManager.default.fileExists(atPath: fileURL.path)
    }

    // MARK: - Load / Save

    /// Read ~/.lilchromium/config.json. Returns `.defaults` on any failure
    /// (missing file, unreadable, undecodable). Per-field defaults are applied
    /// by the defensive decoder above. Never throws.
    public static func load() -> LilConfig {
        let url = fileURL
        guard let data = try? Data(contentsOf: url) else { return .defaults }
        guard let cfg = try? JSONDecoder().decode(LilConfig.self, from: data) else {
            return .defaults
        }
        return cfg
    }

    /// Atomically write the config, PRESERVING any unknown fields already in the
    /// file. Reads the current JSON object (if any), merges only the top-level
    /// keys this struct owns (nested objects replaced whole), and atomically
    /// rewrites (tmp file + rename). Best-effort: swallows errors so a transient
    /// FS problem never crashes the caller. Ensures the state dir exists first.
    ///
    /// See ConfigMerge.mergedJSONData / atomicWrite — the same machinery the host
    /// uses for whitelist-op merges.
    public func save() {
        LilPaths.ensureStateDir()
        let url = LilConfig.fileURL

        // Read whatever is on disk so unknown fields survive the rewrite.
        let existing = (try? Data(contentsOf: url))
        guard let merged = ConfigMerge.mergedJSONData(existing: existing, applying: self) else {
            return
        }
        ConfigMerge.atomicWrite(merged, to: url)
    }
}
