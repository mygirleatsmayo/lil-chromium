import Foundation

/// The canonical catalog of every supported Chromium-family **browser
/// installation**. Shared by the app (BrowserCatalog, OpenRouter fallback),
/// the host (get-context names, open-external launch, parent detection), and
/// the installer (native-host support dirs). Mirrors docs/PROTOCOL.md
/// "Browser slugs".
///
/// Release channels are separate installations, not variants of one browser.
/// `unknown` is intentionally absent (no bundle id, not a routing target).
/// Profiles are not catalog entries.
public enum BrowserTable {

    /// One catalogued installation.
    public struct Entry: Sendable, Equatable {
        public let slug: String
        public let name: String
        public let bundleId: String
        /// Browser product this installation belongs to. Sibling channels
        /// share a product and remain separate routing targets.
        public let product: String
        /// Lowercased substrings matched against `proc_pidpath(getppid())`.
        public let detectionNeedles: [String]
        /// Directory under `~/Library/Application Support` that holds
        /// `NativeMessagingHosts/`.
        ///
        /// verified: Chrome, Chrome Beta, Helium (`net.imput.helium`), Arc
        /// (`Arc/User Data`), Opera, Edge, Brave, Vivaldi, and Chromium each
        /// already had a NativeMessagingHosts folder at this relative path
        /// on macOS 27. Dia and Comet were not installed on the probe machine.
        public let nativeHostDir: String
    }

    /// Full supported set, in Issue #6 listing order. Stable-channel slugs
    /// keep their historical names (`chrome`, `brave`, …) so existing
    /// `config.json` values keep working.
    public static let all: [Entry] = [
        install(slug: "chrome", name: "Google Chrome", bundleId: "com.google.Chrome",
                product: "chrome", app: "Google Chrome.app", nativeHostDir: "Google/Chrome"),
        install(slug: "chrome-beta", name: "Google Chrome Beta", bundleId: "com.google.Chrome.beta",
                product: "chrome", app: "Google Chrome Beta.app", nativeHostDir: "Google/Chrome Beta"),
        install(slug: "chrome-dev", name: "Google Chrome Dev", bundleId: "com.google.Chrome.dev",
                product: "chrome", app: "Google Chrome Dev.app", nativeHostDir: "Google/Chrome Dev"),
        install(slug: "chrome-canary", name: "Google Chrome Canary", bundleId: "com.google.Chrome.canary",
                product: "chrome", app: "Google Chrome Canary.app", nativeHostDir: "Google/Chrome Canary"),

        install(slug: "brave", name: "Brave", bundleId: "com.brave.Browser",
                product: "brave", app: "Brave Browser.app", nativeHostDir: "BraveSoftware/Brave-Browser"),
        install(slug: "brave-beta", name: "Brave Beta", bundleId: "com.brave.Browser.beta",
                product: "brave", app: "Brave Browser Beta.app", nativeHostDir: "BraveSoftware/Brave-Browser-Beta"),
        install(slug: "brave-dev", name: "Brave Dev", bundleId: "com.brave.Browser.dev",
                product: "brave", app: "Brave Browser Dev.app", nativeHostDir: "BraveSoftware/Brave-Browser-Dev"),
        install(slug: "brave-nightly", name: "Brave Nightly", bundleId: "com.brave.Browser.nightly",
                product: "brave", app: "Brave Browser Nightly.app", nativeHostDir: "BraveSoftware/Brave-Browser-Nightly"),

        install(slug: "edge", name: "Microsoft Edge", bundleId: "com.microsoft.edgemac",
                product: "edge", app: "Microsoft Edge.app", nativeHostDir: "Microsoft Edge"),
        install(slug: "edge-beta", name: "Microsoft Edge Beta", bundleId: "com.microsoft.edgemac.Beta",
                product: "edge", app: "Microsoft Edge Beta.app", nativeHostDir: "Microsoft Edge Beta"),
        install(slug: "edge-dev", name: "Microsoft Edge Dev", bundleId: "com.microsoft.edgemac.Dev",
                product: "edge", app: "Microsoft Edge Dev.app", nativeHostDir: "Microsoft Edge Dev"),
        install(slug: "edge-canary", name: "Microsoft Edge Canary", bundleId: "com.microsoft.edgemac.Canary",
                product: "edge", app: "Microsoft Edge Canary.app", nativeHostDir: "Microsoft Edge Canary"),

        install(slug: "vivaldi", name: "Vivaldi", bundleId: "com.vivaldi.Vivaldi",
                product: "vivaldi", app: "Vivaldi.app", nativeHostDir: "Vivaldi"),
        install(slug: "vivaldi-snapshot", name: "Vivaldi Snapshot", bundleId: "com.vivaldi.Vivaldi.snapshot",
                product: "vivaldi", app: "Vivaldi Snapshot.app", nativeHostDir: "Vivaldi Snapshot"),

        install(slug: "opera", name: "Opera", bundleId: "com.operasoftware.Opera",
                product: "opera", app: "Opera.app", nativeHostDir: "com.operasoftware.Opera"),
        install(slug: "opera-gx", name: "Opera GX", bundleId: "com.operasoftware.OperaGX",
                product: "opera", app: "Opera GX.app", nativeHostDir: "com.operasoftware.OperaGX"),
        install(slug: "opera-developer", name: "Opera Developer", bundleId: "com.operasoftware.OperaDeveloper",
                product: "opera", app: "Opera Developer.app", nativeHostDir: "com.operasoftware.OperaDeveloper"),

        install(slug: "helium", name: "Helium", bundleId: "net.imput.helium",
                product: "helium", app: "Helium.app", nativeHostDir: "net.imput.helium",
                extraNeedles: ["helium framework", "helium helper", "net.imput.helium"]),
        install(slug: "arc", name: "Arc", bundleId: "company.thebrowser.Browser",
                product: "arc", app: "Arc.app", nativeHostDir: "Arc/User Data"),
        install(slug: "dia", name: "Dia", bundleId: "company.thebrowser.dia",
                product: "dia", app: "Dia.app", nativeHostDir: "Dia/User Data"),
        install(slug: "comet", name: "Comet", bundleId: "ai.perplexity.comet",
                product: "comet", app: "Comet.app", nativeHostDir: "ai.perplexity.comet"),
        install(slug: "chromium", name: "Chromium", bundleId: "org.chromium.Chromium",
                product: "chromium", app: "Chromium.app", nativeHostDir: "Chromium"),
    ]

    /// Native-host support directories, same order as `all`.
    public static var nativeHostSupportDirectories: [String] {
        all.map(\.nativeHostDir)
    }

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

    /// Match a parent-process executable path to a catalog slug.
    ///
    /// Needles are tried longest-first so a channel folder cannot lose to a
    /// shorter stable-channel needle. Returns `"unknown"` when nothing matches.
    ///
    /// verified: Chrome Beta 152's helpers are still named "Google Chrome
    /// Helper.app" (not "Google Chrome Beta Helper"); the outer
    /// "Google Chrome Beta.app/" is what distinguishes the channel. Chrome
    /// 151 / Chrome Beta 152, macOS 27. Do not use a generic
    /// "google chrome helper" needle — it would claim every Chrome channel.
    public static func slug(matchingExecutablePath path: String) -> String {
        let lower = path.lowercased()
        let ranked = all.flatMap { entry in
            entry.detectionNeedles.map { (slug: entry.slug, needle: $0) }
        }
        .sorted { lhs, rhs in
            if lhs.needle.count != rhs.needle.count {
                return lhs.needle.count > rhs.needle.count
            }
            return lhs.slug < rhs.slug
        }
        return ranked.first { lower.contains($0.needle) }?.slug ?? "unknown"
    }

    /// Build an installation whose primary detection needle is `<app>/`
    /// (lowercased), which is the outer bundle folder native-messaging helpers
    /// live inside.
    private static func install(
        slug: String,
        name: String,
        bundleId: String,
        product: String,
        app: String,
        nativeHostDir: String,
        extraNeedles: [String] = []
    ) -> Entry {
        let folder = app.lowercased()
        let needles = ["\(folder)/"] + extraNeedles.map { $0.lowercased() }
        return Entry(
            slug: slug,
            name: name,
            bundleId: bundleId,
            product: product,
            detectionNeedles: needles,
            nativeHostDir: nativeHostDir
        )
    }
}
