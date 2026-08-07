import Foundation

/// The canonical slug → (display name, bundle id) table for every known
/// Chromium-family browser. Single source of truth shared by the app
/// (BrowserCatalog, OpenRouter fallback) and the host (get-context names,
/// open-external launch, pong). Mirrors docs/PROTOCOL.md "Browser slugs".
public enum BrowserTable {

    /// One catalog entry.
    public struct Entry: Sendable {
        public let slug: String
        public let name: String
        public let bundleId: String
        public init(slug: String, name: String, bundleId: String) {
            self.slug = slug
            self.name = name
            self.bundleId = bundleId
        }
    }

    /// Detection/priority order: specific brands before generic Chrome/Chromium.
    /// `unknown` is intentionally absent from this list (it has no bundle id).
    public static let all: [Entry] = [
        Entry(slug: "helium",   name: "Helium",         bundleId: "net.imput.helium"),
        Entry(slug: "brave",    name: "Brave",          bundleId: "com.brave.Browser"),
        Entry(slug: "edge",     name: "Microsoft Edge", bundleId: "com.microsoft.edgemac"),
        Entry(slug: "arc",      name: "Arc",            bundleId: "company.thebrowser.Browser"),
        Entry(slug: "vivaldi",  name: "Vivaldi",        bundleId: "com.vivaldi.Vivaldi"),
        Entry(slug: "chrome",   name: "Google Chrome",  bundleId: "com.google.Chrome"),
        Entry(slug: "chromium", name: "Chromium",       bundleId: "org.chromium.Chromium"),
    ]

    /// Look up an entry by slug.
    public static func entry(forSlug slug: String) -> Entry? {
        all.first { $0.slug == slug }
    }

    /// Bundle id for a slug, or nil for "unknown"/unrecognized slugs.
    public static func bundleId(forSlug slug: String) -> String? {
        entry(forSlug: slug)?.bundleId
    }

    /// Display name for a slug. Falls back to the capitalized slug (or
    /// "Unknown" for the unknown/empty slug) so callers always get something.
    public static func name(forSlug slug: String) -> String {
        if let e = entry(forSlug: slug) { return e.name }
        if slug.isEmpty || slug == "unknown" { return "Unknown" }
        return slug.prefix(1).uppercased() + slug.dropFirst()
    }
}
