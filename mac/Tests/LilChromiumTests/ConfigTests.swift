import Foundation
import Testing
@testable import LilShared

/// Config decoding at the disk boundary: a config written by an older component
/// must still load, and every field the older writer never knew about must
/// arrive at its documented default (docs/PROTOCOL.md, "Config file").
struct ConfigDecodingTests {

    /// v0.4 reads the explicit Chromium destination written by v0.3 under its
    /// legacy `defaultBrowser` key as the configured Primary browser.
    @Test func v03ExplicitBrowserBecomesPrimaryBrowser() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")

        #expect(cfg.primaryBrowser == "helium")
    }

    /// v0.3 compatibility: a v1-era file predates ephemerality, Lil Nap, search
    /// engine, and hover bar. Each addition is additive — the fields the file
    /// does carry survive, the rest default.
    @Test func legacyConfigGetsAdditiveDefaults() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v1-legacy")

        // Present in the legacy file: preserved verbatim.
        #expect(cfg.version == 1)
        #expect(cfg.primaryBrowser == "brave")
        #expect(cfg.paletteAnchor == "top-right")
        #expect(cfg.linkBehavior == "same-lil")

        // Absent from the legacy file: documented defaults. searchEngine is
        // Startpage (issue #10); every other missing field follows PROTOCOL.md.
        #expect(cfg.fallbackBrowser == "chrome")
        #expect(cfg.ephemeralDefault == "never")
        #expect(cfg.sleep.enabled == false)
        #expect(cfg.sleep.afterMinutes == 30)
        #expect(cfg.sleep.audioGuard)
        #expect(cfg.sleep.formGuard)
        #expect(cfg.sleep.tint == "purple")
        #expect(cfg.sleep.whitelist == [])
        #expect(cfg.searchEngine.name == "Startpage")
        #expect(cfg.searchEngine.provider == "startpage")
        #expect(cfg.searchEngine.template == "https://www.startpage.com/sp/search?query=%s")
        #expect(cfg.hoverBar.style == "glass")
        #expect(cfg.hoverBar.tint == nil)
        #expect(cfg.knownBrowsers.count == 0)
    }

    /// A complete v2 file decodes verbatim — no default ever overwrites a value
    /// the user actually set.
    @Test func completeConfigDecodesVerbatim() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")

        #expect(cfg.version == 2)
        #expect(cfg.primaryBrowser == "helium")
        #expect(cfg.fallbackBrowser == "chrome")
        #expect(cfg.ephemeralDefault == "6h")
        #expect(cfg.sleep.enabled)
        #expect(cfg.sleep.afterMinutes == 45)
        #expect(cfg.sleep.formGuard == false)
        #expect(cfg.sleep.tint == "#3311aa")
        #expect(cfg.sleep.whitelist == ["mail.google.com"])
        #expect(cfg.searchEngine.name == "Kagi")
        #expect(cfg.searchEngine.provider == "kagi")
        #expect(cfg.searchEngine.template == "https://kagi.com/search?q=%s")
        #expect(cfg.hoverBar.style == "solid")
        #expect(cfg.hoverBar.tint == "#112233")
        #expect(cfg.knownBrowsers.map(\.slug) == ["helium", "chrome", "vivaldi"])
        #expect(cfg.knownBrowsers.map(\.installed) == [true, true, false])
    }

    @Test func canonicalV04ConfigDecodesVerbatim() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v3-complete")

        #expect(cfg.version == 3)
        #expect(cfg.primaryBrowser == "helium")
        #expect(cfg.fallbackBrowser == "chrome")
        #expect(cfg.searchEngine.provider == "kagi")
        #expect(cfg.hoverBar.revealHeight == 24)
        #expect(cfg.knownBrowsers.map(\.slug) == ["helium", "chrome", "vivaldi"])
    }
}

/// The hover-bar reveal zone (issue #12): an additive v0.4 field with a
/// 15-pixel default, clamped to the inclusive 0...48 range at the config
/// model — the shared source of truth every consumer reads (PROTOCOL.md).
struct RevealHeightTests {

    /// A config written before the reveal zone existed decodes to the
    /// documented default, whether it predates hoverBar entirely (v1) or
    /// simply lacks the key (unknown-fields fixture).
    @Test func absentRevealHeightDefaultsToFifteen() throws {
        let legacy = try Fixture.decode(LilConfig.self, from: "config-v1-legacy")
        #expect(legacy.hoverBar.revealHeight == 15)

        let unknowns = try Fixture.decode(LilConfig.self, from: "config-with-unknown-fields")
        #expect(unknowns.hoverBar.revealHeight == 15)
    }

    /// Out-of-range bytes on disk clamp into 0...48 on decode, so a hand-edit
    /// can never push an unusable zone to a host or the extension.
    @Test func revealHeightClampsIntoRangeOnDecode() throws {
        let highJSON = #"{"hoverBar":{"revealHeight":100}}"#
        let high = try LilCodec.decode(LilConfig.self, from: Data(highJSON.utf8))
        #expect(high.hoverBar.revealHeight == 48)

        let lowJSON = #"{"hoverBar":{"revealHeight":-5}}"#
        let low = try LilCodec.decode(LilConfig.self, from: Data(lowJSON.utf8))
        #expect(low.hoverBar.revealHeight == 0)
    }

    /// The model clamps every write path, not just decoding: a Settings edit
    /// can never put an out-of-range value into config.json or a broadcast.
    @Test func revealHeightClampsOnWrite() throws {
        var hoverBar = HoverBarConfig()
        #expect(hoverBar.revealHeight == 15)

        hoverBar.revealHeight = 200
        #expect(hoverBar.revealHeight == 48)

        hoverBar.revealHeight = -1
        #expect(hoverBar.revealHeight == 0)

        hoverBar.revealHeight = 33
        #expect(hoverBar.revealHeight == 33)
    }

    /// Zero is a real setting, not a missing one: it must survive a
    /// decode/encode round-trip so "mouse reveal off" reaches every lil.
    @Test func zeroRevealHeightRoundTrips() throws {
        var hoverBar = HoverBarConfig()
        hoverBar.revealHeight = 0
        let decoded = try LilCodec.decode(HoverBarConfig.self, from: LilCodec.encode(hoverBar))

        #expect(decoded.revealHeight == 0)
    }
}
