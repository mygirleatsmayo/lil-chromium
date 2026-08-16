import Testing
@testable import LilShared

/// Config decoding at the disk boundary: a config written by an older component
/// must still load, and every field the older writer never knew about must
/// arrive at its documented default (docs/PROTOCOL.md, "Config file").
struct ConfigDecodingTests {

    /// v0.3 compatibility: a v1-era file predates ephemerality, Lil Nap, search
    /// engine, and hover bar. Each addition is additive — the fields the file
    /// does carry survive, the rest default.
    @Test func legacyConfigGetsAdditiveDefaults() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v1-legacy")

        // Present in the legacy file: preserved verbatim.
        #expect(cfg.version == 1)
        #expect(cfg.defaultBrowser == "brave")
        #expect(cfg.paletteAnchor == "top-right")
        #expect(cfg.linkBehavior == "same-lil")

        // Absent from the legacy file: documented defaults.
        #expect(cfg.fallbackBrowser == "chrome")
        #expect(cfg.ephemeralDefault == "never")
        #expect(cfg.sleep.enabled == false)
        #expect(cfg.sleep.afterMinutes == 30)
        #expect(cfg.sleep.audioGuard)
        #expect(cfg.sleep.formGuard)
        #expect(cfg.sleep.tint == "purple")
        #expect(cfg.sleep.whitelist == [])
        #expect(cfg.searchEngine.name == "Google")
        #expect(cfg.searchEngine.template == "https://www.google.com/search?q=%s")
        #expect(cfg.hoverBar.style == "glass")
        #expect(cfg.hoverBar.tint == nil)
        #expect(cfg.knownBrowsers.count == 0)
    }

    /// A complete v2 file decodes verbatim — no default ever overwrites a value
    /// the user actually set.
    @Test func completeConfigDecodesVerbatim() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")

        #expect(cfg.version == 2)
        #expect(cfg.defaultBrowser == "helium")
        #expect(cfg.fallbackBrowser == "chrome")
        #expect(cfg.ephemeralDefault == "6h")
        #expect(cfg.sleep.enabled)
        #expect(cfg.sleep.afterMinutes == 45)
        #expect(cfg.sleep.formGuard == false)
        #expect(cfg.sleep.tint == "#3311aa")
        #expect(cfg.sleep.whitelist == ["mail.google.com"])
        #expect(cfg.searchEngine.name == "Kagi")
        #expect(cfg.hoverBar.style == "solid")
        #expect(cfg.hoverBar.tint == "#112233")
        #expect(cfg.knownBrowsers.map(\.slug) == ["helium", "chrome", "vivaldi"])
        #expect(cfg.knownBrowsers.map(\.installed) == [true, true, false])
    }
}
