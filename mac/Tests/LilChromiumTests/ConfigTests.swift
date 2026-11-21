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
        #expect(cfg.sleep.localGuard)
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
        #expect(cfg.sleep.localGuard == false)
        #expect(cfg.hoverBar.revealHeight == 24)
        #expect(cfg.knownBrowsers.map(\.slug) == ["helium", "chrome", "vivaldi"])
    }
}

/// The Lil Nap local guard (issue #46): an additive field that defaults ON
/// and survives every write.
struct LocalGuardTests {

    /// An off guard is a real user setting: it must survive encode/decode, so
    /// a Settings save never silently turns it back on.
    @Test func offLocalGuardRoundTrips() throws {
        var sleep = SleepConfig()
        #expect(sleep.localGuard)

        sleep.localGuard = false
        let decoded = try LilCodec.decode(SleepConfig.self, from: LilCodec.encode(sleep))

        #expect(decoded.localGuard == false)
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

/// Palette history settings (issue #43): the history window, word matching,
/// and the palette's row budget. Additive fields; existing files need no
/// migration, and the config model is the single clamp site for `maxResults`.
struct PaletteSettingsTests {

    /// Files written before these settings existed decode to the defaults.
    @Test(.bug(id: 43)) func absentPaletteSettingsDecodeToDefaults() throws {
        for name in ["config-v1-legacy", "config-with-unknown-fields"] {
            let cfg = try Fixture.decode(LilConfig.self, from: name)
            #expect(cfg.history.windowDays == 90)
            #expect(cfg.palette.maxResults == 8)
            #expect(cfg.palette.wordMatch == .anyOrder)
        }
    }

    @Test(.bug(id: 43)) func canonicalFileDecodesPaletteSettingsVerbatim() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v3-complete")

        #expect(cfg.history.windowDays == 30)
        #expect(cfg.palette.maxResults == 10)
        #expect(cfg.palette.wordMatch == .phrase)
    }

    /// Bytes on disk the model cannot honor fall back field by field: a
    /// negative or fractional window and an unknown match mode take the
    /// defaults; `windowDays` 0 ("All") is a real value.
    @Test(.bug(id: 43), arguments: [
        (#"{"history":{"windowDays":0}}"#, 0),
        (#"{"history":{"windowDays":-7}}"#, 90),
        (#"{"history":{"windowDays":7.5}}"#, 90),
        (#"{"history":{"windowDays":"7"}}"#, 90),
    ])
    func windowDaysDecodes(json: String, expected: Int) throws {
        let cfg = try LilCodec.decode(LilConfig.self, from: Data(json.utf8))
        #expect(cfg.history.windowDays == expected)
    }

    @Test(.bug(id: 43)) func unknownWordMatchDecodesToAnyOrder() throws {
        let json = #"{"palette":{"wordMatch":"fuzzy","maxResults":5}}"#
        let cfg = try LilCodec.decode(LilConfig.self, from: Data(json.utf8))

        #expect(cfg.palette.wordMatch == .anyOrder)
        #expect(cfg.palette.maxResults == 5, "a bad sibling field keeps the good one")
    }

    @Test(.bug(id: 43)) func maxResultsClampsIntoRangeOnDecode() throws {
        let high = try LilCodec.decode(LilConfig.self, from: Data(#"{"palette":{"maxResults":40}}"#.utf8))
        #expect(high.palette.maxResults == 12)

        let low = try LilCodec.decode(LilConfig.self, from: Data(#"{"palette":{"maxResults":1}}"#.utf8))
        #expect(low.palette.maxResults == 4)
    }

    @Test(.bug(id: 43)) func maxResultsClampsOnWrite() {
        var palette = PaletteConfig()
        palette.maxResults = 99
        #expect(palette.maxResults == 12)
        palette.maxResults = 0
        #expect(palette.maxResults == 4)
        palette.maxResults = 6
        #expect(palette.maxResults == 6)
        #expect(PaletteConfig(maxResults: 2).maxResults == 4)
    }

    @Test(.bug(id: 43)) func paletteSettingsRoundTrip() throws {
        var cfg = LilConfig.defaults
        cfg.history.windowDays = 0
        cfg.palette.maxResults = 12
        cfg.palette.wordMatch = .phrase

        let decoded = try LilCodec.decode(LilConfig.self, from: LilCodec.encode(cfg))

        #expect(decoded.history.windowDays == 0)
        #expect(decoded.palette.maxResults == 12)
        #expect(decoded.palette.wordMatch == .phrase)
    }

    /// The wire spelling is the contract all three components read.
    @Test(.bug(id: 43)) func paletteSettingsEncodeWithContractNames() throws {
        let object = try #require(
            try JSONSerialization.jsonObject(with: LilCodec.encode(LilConfig.defaults)) as? [String: Any]
        )
        let history = try #require(object["history"] as? [String: Any])
        let palette = try #require(object["palette"] as? [String: Any])

        #expect(history["windowDays"] as? Int == 90)
        #expect(palette["maxResults"] as? Int == 8)
        #expect(palette["wordMatch"] as? String == "any-order")
    }
}
