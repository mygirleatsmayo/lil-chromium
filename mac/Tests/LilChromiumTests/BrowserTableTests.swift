import Foundation
import Testing
@testable import LilShared

/// The catalog in `BrowserTable` is protocol surface: slugs, bundle ids,
/// detection needles, and native-host dirs must cover Issue #6's full set,
/// stay distinct across sibling channels, and never encode a profile.
struct BrowserTableTests {

    /// Issue #6 criterion 1, listing order.
    private static let expectedSlugs = [
        "chrome", "chrome-beta", "chrome-dev", "chrome-canary",
        "brave", "brave-beta", "brave-dev", "brave-nightly",
        "edge", "edge-beta", "edge-dev", "edge-canary",
        "vivaldi", "vivaldi-snapshot",
        "opera", "opera-gx", "opera-developer",
        "helium", "arc", "dia", "comet", "chromium",
    ]

    private static var protocolText: String {
        get throws {
            let url = Fixture.directory
                .deletingLastPathComponent()
                .appendingPathComponent("docs/PROTOCOL.md")
            return try String(contentsOf: url, encoding: .utf8)
        }
    }

    @Test func catalogIsTheFullSupportedSet() {
        #expect(BrowserTable.all.map(\.slug) == Self.expectedSlugs)
        #expect(BrowserTable.all.contains { $0.slug == "unknown" } == false)
    }

    @Test func everyInstallationHasStableIdentity() {
        for entry in BrowserTable.all {
            #expect(entry.slug.isEmpty == false, "slug")
            #expect(entry.name.isEmpty == false, "display name for \(entry.slug)")
            #expect(entry.bundleId.isEmpty == false, "bundle id for \(entry.slug)")
            #expect(entry.detectionNeedles.isEmpty == false, "host-detection evidence for \(entry.slug)")
            #expect(entry.nativeHostDir.isEmpty == false, "native-host dir for \(entry.slug)")
            #expect(entry.product.isEmpty == false, "product for \(entry.slug)")
        }
    }

    @Test func routingIdentitiesAreUnique() {
        let slugs = BrowserTable.all.map(\.slug)
        let bundleIds = BrowserTable.all.map(\.bundleId)
        let dirs = BrowserTable.all.map(\.nativeHostDir)
        #expect(Set(slugs).count == slugs.count)
        #expect(Set(bundleIds).count == bundleIds.count)
        #expect(Set(dirs).count == dirs.count)
    }

    /// Sibling channels of one product are distinct selectable installations.
    @Test func siblingChannelsRemainSeparateInstallations() {
        let byProduct = Dictionary(grouping: BrowserTable.all, by: \.product)
        let channelled = ["chrome", "brave", "edge", "vivaldi", "opera"]
        for product in channelled {
            let siblings = byProduct[product] ?? []
            #expect(siblings.count > 1, "\(product) must catalogue more than one channel")
            #expect(Set(siblings.map(\.slug)).count == siblings.count)
            #expect(Set(siblings.map(\.bundleId)).count == siblings.count)
            #expect(Set(siblings.map(\.nativeHostDir)).count == siblings.count)
        }
    }

    /// Profiles are not routing targets — no catalog field names a profile.
    @Test func profilesAreNotRoutingTargets() {
        for entry in BrowserTable.all {
            let haystacks = [entry.slug, entry.bundleId, entry.nativeHostDir, entry.name]
            for text in haystacks {
                let lower = text.lowercased()
                #expect(lower.contains("profile") == false, "\(entry.slug) encodes a profile in \(text)")
                #expect(lower.hasSuffix("/default") == false, "\(entry.slug) points at a Default profile")
            }
        }
    }

    @Test(arguments: BrowserTableTests.expectedSlugs)
    func needlePathResolvesToItsOwnSlug(slug: String) throws {
        let entry = try #require(BrowserTable.entry(forSlug: slug))
        let needle = try #require(entry.detectionNeedles.first)
        let path = "/Applications/\(needle)Contents/Frameworks/Helper.app/Contents/MacOS/Helper"
        #expect(BrowserTable.slug(matchingExecutablePath: path) == slug)
    }

    /// verified: Chrome Beta helpers are named "Google Chrome Helper.app".
    /// A generic "google chrome helper" needle would mis-detect Beta as chrome.
    @Test func chromeBetaHelperPathIsNotChromeStable() {
        let path = "/Applications/Google Chrome Beta.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/152.0.7977.42/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper"
        #expect(BrowserTable.slug(matchingExecutablePath: path) == "chrome-beta")
    }

    @Test func chromeStableHelperPathIsChrome() {
        let path = "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/151.0.7922.138/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper"
        #expect(BrowserTable.slug(matchingExecutablePath: path) == "chrome")
    }

    @Test func unmatchedParentIsUnknown() {
        #expect(BrowserTable.slug(matchingExecutablePath: "/usr/bin/swift") == "unknown")
        #expect(BrowserTable.slug(matchingExecutablePath: "") == "unknown")
    }

    @Test func detectionNeedlesDoNotCrossMatch() {
        for entry in BrowserTable.all {
            let path = "/Applications/\(entry.detectionNeedles[0])Contents/MacOS/Helper".lowercased()
            for other in BrowserTable.all where other.slug != entry.slug {
                let hit = other.detectionNeedles.contains { path.contains($0) }
                #expect(hit == false, "\(other.slug) needle matches \(entry.slug)'s path")
            }
        }
    }

    /// Discovery, host detection, native-host dirs, and PROTOCOL.md name the
    /// same catalog (criterion 5).
    @Test func protocolDocumentsEveryCatalogEntry() throws {
        let text = try Self.protocolText
        for entry in BrowserTable.all {
            #expect(text.contains("`\(entry.slug)`"), "PROTOCOL.md names slug \(entry.slug)")
            #expect(text.contains("`\(entry.bundleId)`"), "PROTOCOL.md names bundle id \(entry.bundleId)")
            #expect(text.contains("`\(entry.nativeHostDir)`"), "PROTOCOL.md names native-host dir \(entry.nativeHostDir)")
        }
        #expect(text.contains("`unknown`"))
        #expect(text.lowercased().contains("profile") == true, "PROTOCOL.md must say profiles are not slugs")
    }
}
