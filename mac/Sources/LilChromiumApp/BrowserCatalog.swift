import AppKit
import Foundation
import LilShared

/// Scans the system for installed Chromium-family browsers and produces the
/// `knownBrowsers` list written into config. Uses Launch Services
/// (NSWorkspace) rather than a hard-coded /Applications path so browsers in
/// ~/Applications or elsewhere are still found.
enum BrowserCatalog {

    /// Probe every browser in the shared table. `installed` reflects whether
    /// Launch Services can resolve the bundle id; the display name comes from
    /// the on-disk bundle when available, else the table.
    static func scan() -> [KnownBrowser] {
        let ws = NSWorkspace.shared
        return BrowserTable.all.map { entry in
            let appURL = ws.urlForApplication(withBundleIdentifier: entry.bundleId)
            let installed = (appURL != nil)
            let name = appURL.flatMap(displayName(atAppURL:)) ?? entry.name
            return KnownBrowser(
                slug: entry.slug,
                name: name,
                bundleId: entry.bundleId,
                installed: installed
            )
        }
    }

    /// Best display name for an installed app bundle: CFBundleDisplayName ->
    /// CFBundleName -> the file name without ".app". Nil if unreadable.
    private static func displayName(atAppURL url: URL) -> String? {
        if let bundle = Bundle(url: url) {
            if let display = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String,
               !display.isEmpty {
                return display
            }
            if let name = bundle.object(forInfoDictionaryKey: "CFBundleName") as? String,
               !name.isEmpty {
                return name
            }
        }
        let base = url.deletingPathExtension().lastPathComponent
        return base.isEmpty ? nil : base
    }

    /// Scan and merge results into `config.knownBrowsers`, preserving the
    /// user's chosen default/fallback/anchor/linkBehavior. Returns the updated
    /// config (not yet saved — the caller decides when to persist).
    static func merged(into config: LilConfig) -> LilConfig {
        var updated = config
        updated.knownBrowsers = scan()
        return updated
    }

    /// True when `slug` resolves to an installed browser in `config`.
    static func isInstalled(_ slug: String, in config: LilConfig) -> Bool {
        config.knownBrowsers.first(where: { $0.slug == slug })?.installed ?? false
    }
}
