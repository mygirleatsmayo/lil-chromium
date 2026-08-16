import XCTest
@testable import LilShared

/// Config decoding at the disk boundary: a config written by an older component
/// must still load, and every field the older writer never knew about must
/// arrive at its documented default (docs/PROTOCOL.md, "Config file").
final class ConfigDecodingTests: XCTestCase {

    /// v0.3 compatibility: a v1-era file predates ephemerality, Lil Nap, search
    /// engine, and hover bar. Each addition is additive — the fields the file
    /// does carry survive, the rest default.
    func testLegacyConfigGetsAdditiveDefaults() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v1-legacy")

        // Present in the legacy file: preserved verbatim.
        XCTAssertEqual(cfg.version, 1)
        XCTAssertEqual(cfg.defaultBrowser, "brave")
        XCTAssertEqual(cfg.paletteAnchor, "top-right")
        XCTAssertEqual(cfg.linkBehavior, "same-lil")

        // Absent from the legacy file: documented defaults.
        XCTAssertEqual(cfg.fallbackBrowser, "chrome")
        XCTAssertEqual(cfg.ephemeralDefault, "never")
        XCTAssertFalse(cfg.sleep.enabled)
        XCTAssertEqual(cfg.sleep.afterMinutes, 30)
        XCTAssertTrue(cfg.sleep.audioGuard)
        XCTAssertTrue(cfg.sleep.formGuard)
        XCTAssertEqual(cfg.sleep.tint, "purple")
        XCTAssertEqual(cfg.sleep.whitelist, [])
        XCTAssertEqual(cfg.searchEngine.name, "Google")
        XCTAssertEqual(cfg.searchEngine.template, "https://www.google.com/search?q=%s")
        XCTAssertEqual(cfg.hoverBar.style, "glass")
        XCTAssertNil(cfg.hoverBar.tint)
        XCTAssertEqual(cfg.knownBrowsers.count, 0)
    }

    /// A complete v2 file decodes verbatim — no default ever overwrites a value
    /// the user actually set.
    func testCompleteConfigDecodesVerbatim() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")

        XCTAssertEqual(cfg.version, 2)
        XCTAssertEqual(cfg.defaultBrowser, "helium")
        XCTAssertEqual(cfg.fallbackBrowser, "chrome")
        XCTAssertEqual(cfg.ephemeralDefault, "6h")
        XCTAssertTrue(cfg.sleep.enabled)
        XCTAssertEqual(cfg.sleep.afterMinutes, 45)
        XCTAssertFalse(cfg.sleep.formGuard)
        XCTAssertEqual(cfg.sleep.tint, "#3311aa")
        XCTAssertEqual(cfg.sleep.whitelist, ["mail.google.com"])
        XCTAssertEqual(cfg.searchEngine.name, "Kagi")
        XCTAssertEqual(cfg.hoverBar.style, "solid")
        XCTAssertEqual(cfg.hoverBar.tint, "#112233")
        XCTAssertEqual(cfg.knownBrowsers.map(\.slug), ["helium", "chrome", "vivaldi"])
        XCTAssertEqual(cfg.knownBrowsers.map(\.installed), [true, true, false])
    }
}
