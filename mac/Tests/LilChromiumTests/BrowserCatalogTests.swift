import Foundation
import Testing
@testable import LilChromiumApp
@testable import LilShared

/// Browser discovery writes the full catalog into `knownBrowsers`. Unavailable
/// installations stay listed and are not offered as installed choices.
struct BrowserCatalogTests {

    @Test func scanKeepsUnavailableInstallations() {
        let chromeURL = URL(fileURLWithPath: "/tmp/Google Chrome.app")
        let scanned = BrowserCatalog.scan { bundleId in
            bundleId == "com.google.Chrome" ? chromeURL : nil
        }

        #expect(scanned.map(\.slug) == BrowserTable.all.map(\.slug))
        let chrome = scanned.first { $0.slug == "chrome" }
        let beta = scanned.first { $0.slug == "chrome-beta" }
        #expect(chrome?.installed == true)
        #expect(chrome?.bundleId == "com.google.Chrome")
        #expect(beta?.installed == false)
        #expect(beta?.name == "Google Chrome Beta", "unavailable entries keep the catalog display name")
        #expect(scanned.filter(\.installed).count == 1)
    }

    @Test func unavailableInstallationsAreNotOfferedAsChoices() {
        let known = [
            KnownBrowser(slug: "chrome", name: "Google Chrome", bundleId: "com.google.Chrome", installed: true),
            KnownBrowser(slug: "chrome-beta", name: "Google Chrome Beta", bundleId: "com.google.Chrome.beta", installed: false),
            KnownBrowser(slug: "helium", name: "Helium", bundleId: "net.imput.helium", installed: true),
        ]

        let choices = BrowserCatalog.installedChoices(from: known)
        #expect(choices.map(\.slug) == ["chrome", "helium"])
        #expect(choices.contains { $0.installed == false } == false)
    }

    @Test func mergedReplacesKnownBrowsersWithTheFullScan() {
        var cfg = LilConfig.defaults
        cfg.knownBrowsers = [
            KnownBrowser(slug: "chrome", name: "stale", bundleId: "old", installed: true)
        ]
        let updated = BrowserCatalog.merged(into: cfg, urlForBundleId: { _ in nil })

        #expect(updated.knownBrowsers.count == BrowserTable.all.count)
        #expect(updated.knownBrowsers.allSatisfy { $0.installed == false })
        #expect(updated.defaultBrowser == cfg.defaultBrowser)
        #expect(updated.fallbackBrowser == cfg.fallbackBrowser)
    }

    @Test func isInstalledReadsTheCatalogFlag() {
        var cfg = LilConfig.defaults
        cfg.knownBrowsers = [
            KnownBrowser(slug: "chrome", name: "Google Chrome", bundleId: "com.google.Chrome", installed: true),
            KnownBrowser(slug: "brave", name: "Brave", bundleId: "com.brave.Browser", installed: false),
        ]
        #expect(BrowserCatalog.isInstalled("chrome", in: cfg))
        #expect(BrowserCatalog.isInstalled("brave", in: cfg) == false)
        #expect(BrowserCatalog.isInstalled("opera", in: cfg) == false)
    }
}
