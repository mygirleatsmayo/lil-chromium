import Foundation

// User configuration shared by the app and the hosts. Written by the app
// (Settings window / menu); read fresh by each host on every `get-context`.
// Stored at ~/.lilchromium/config.json. See docs/PROTOCOL.md (Config file).
//
// Decoding is deliberately defensive: any missing field falls back to its
// per-field default, and any hard decode failure (corrupt JSON, wrong types
// at the top level) yields `.defaults` rather than throwing. Config is never
// load-bearing enough to justify crashing a menu-bar agent or a relay host.

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

/// The full user config.
public struct LilConfig: Codable, Sendable {
    public var version: Int
    public var defaultBrowser: String   // slug
    public var fallbackBrowser: String  // slug
    public var paletteAnchor: String    // "top-center" | "top-right"
    public var linkBehavior: String     // "same-lil" | "new-lil"
    public var knownBrowsers: [KnownBrowser]

    public init(
        version: Int,
        defaultBrowser: String,
        fallbackBrowser: String,
        paletteAnchor: String,
        linkBehavior: String,
        knownBrowsers: [KnownBrowser]
    ) {
        self.version = version
        self.defaultBrowser = defaultBrowser
        self.fallbackBrowser = fallbackBrowser
        self.paletteAnchor = paletteAnchor
        self.linkBehavior = linkBehavior
        self.knownBrowsers = knownBrowsers
    }

    /// Built-in defaults: helium / chrome / top-center / same-lil / [].
    public static let defaults = LilConfig(
        version: 1,
        defaultBrowser: "helium",
        fallbackBrowser: "chrome",
        paletteAnchor: "top-center",
        linkBehavior: "same-lil",
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

    /// Atomically write the config (tmp file + rename) as pretty-printed JSON.
    /// Best-effort: swallows errors so a transient FS problem never crashes the
    /// caller. Ensures the state dir exists first.
    public func save() {
        LilPaths.ensureStateDir()
        let url = LilConfig.fileURL
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(self) else { return }

        // Write to a sibling tmp file, then atomically rename over the target.
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent(".config.json.tmp-\(getpid())", isDirectory: false)
        do {
            try data.write(to: tmp, options: .atomic)
            // Rename is atomic within the same directory. Foundation's
            // replaceItemAt handles an existing destination; fall back to a
            // direct move when the destination does not yet exist.
            if FileManager.default.fileExists(atPath: url.path) {
                _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
            } else {
                try FileManager.default.moveItem(at: tmp, to: url)
            }
        } catch {
            // Clean up the tmp file on any failure; ignore secondary errors.
            try? FileManager.default.removeItem(at: tmp)
        }
    }
}
