import Foundation
import Testing
@testable import LilShared

/// The read-merge-write contract for `config.json`: every writer (app AND host)
/// preserves fields it does not own, and writes normalized bytes.
/// See docs/PROTOCOL.md, "Config file".
struct ConfigMergeTests {

    /// A v0.4 writer may add top-level sections (here: `unknownSectionProbe`)
    /// a v0.3 writer has never heard of. Saving from the older model must not
    /// delete them.
    @Test func savePreservesUnknownTopLevelFields() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        var cfg = try JSONDecoder().decode(LilConfig.self, from: existing)
        cfg.defaultBrowser = "brave"

        let merged = try #require(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let out = try jsonObject(merged)

        // Owned key rewritten.
        #expect(out["defaultBrowser"] as? String == "brave")
        // Unowned section untouched, values and all.
        let probe = try #require(out["unknownSectionProbe"] as? [String: Any])
        #expect(probe["someNumber"] as? Int == 24)
        #expect(probe["someFlag"] as? Bool == true)
    }

    /// PROTOCOL.md promises only that unknown fields survive a rewrite; how an
    /// owned nested object is merged is implementation, not contract, and is
    /// deliberately not pinned here. So: an unchanged save keeps the unknown
    /// top-level section, values intact.
    @Test func unchangedSaveKeepsUnknownFieldsVerbatim() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let cfg = try JSONDecoder().decode(LilConfig.self, from: existing)

        let merged = try #require(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let probe = try #require(try jsonObject(merged)["unknownSectionProbe"] as? [String: Any])

        #expect(probe["someNumber"] as? Int == 24)
        #expect(probe["someFlag"] as? Bool == true)
    }

    /// With no file on disk yet, the merge is just the encoded config.
    @Test func saveFromNoExistingFileWritesTheConfig() throws {
        let merged = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: .defaults))
        let out = try jsonObject(merged)

        #expect(out["version"] as? Int == 2)
        #expect(out["defaultBrowser"] as? String == "helium")
        #expect(out["linkBehavior"] as? String == "new-lil")
    }

    /// Corrupt bytes on disk must not block a rewrite (the file is never
    /// load-bearing enough to wedge a writer).
    @Test func saveOverCorruptFileStillWrites() throws {
        let merged = try #require(
            ConfigMerge.mergedJSONData(existing: Data("not json".utf8), applying: .defaults)
        )
        #expect(try jsonObject(merged)["defaultBrowser"] as? String == "helium")
    }

    // MARK: - Normalized encoding

    /// Written bytes are normalized: sorted keys, pretty-printed, and stable
    /// across identical saves so the file does not churn.
    @Test func writtenBytesAreSortedAndStable() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let cfg = try JSONDecoder().decode(LilConfig.self, from: existing)

        let first = try #require(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let second = try #require(ConfigMerge.mergedJSONData(existing: first, applying: cfg))
        #expect(first == second, "an unchanged save must be byte-identical")

        let text = try #require(String(data: first, encoding: .utf8))
        let keyOrder = ["defaultBrowser", "ephemeralDefault", "fallbackBrowser", "hoverBar",
                        "knownBrowsers", "linkBehavior", "paletteAnchor", "searchEngine",
                        "sleep", "unknownSectionProbe", "version"]
        let offsets = keyOrder.compactMap { text.range(of: "\"\($0)\"")?.lowerBound }
        #expect(offsets.count == keyOrder.count, "every top-level key is present")
        #expect(offsets == offsets.sorted(), "top-level keys are written in sorted order")
        #expect(text.contains("\n"), "config.json is pretty-printed for humans")
    }

    /// An absent optional is absent from the file — never an explicit null.
    @Test func absentHoverBarTintIsOmittedNotNull() throws {
        let merged = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: .defaults))
        let hoverBar = try #require(try jsonObject(merged)["hoverBar"] as? [String: Any])

        #expect(hoverBar["style"] as? String == "glass")
        #expect(hoverBar["tint"] == nil)
        let text = try #require(String(data: merged, encoding: .utf8))
        #expect(text.contains("null") == false, "no field is ever written as an explicit null")
    }

    // MARK: - whitelist-op (host-side edit)

    /// The host's `whitelist-op` is a surgical edit: it touches only
    /// `sleep.whitelist` and preserves unknown keys anywhere else — including
    /// inside `sleep` itself, which a full save would replace.
    @Test func whitelistAddPreservesEverythingElse() throws {
        let existing = try Fixture.data("config-with-unknown-fields")

        let merged = try #require(
            ConfigMerge.applyWhitelistOp(existing: existing, op: "add", domain: "https://News.YCombinator.com/newest")
        )
        let out = try jsonObject(merged)
        let sleep = try #require(out["sleep"] as? [String: Any])

        // Domains are normalized to a bare lowercased host.
        #expect(sleep["whitelist"] as? [String] == ["mail.google.com", "news.ycombinator.com"])
        // Unknown keys survive — both nested and top-level.
        #expect(sleep["unknownNestedProbe"] as? String == "chime")
        #expect(out["unknownSectionProbe"] != nil)
        #expect(out["version"] as? Int == 3, "a host edit never downgrades the schema version")
    }

    @Test func whitelistAddIsIdempotent() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let once = try #require(ConfigMerge.applyWhitelistOp(existing: existing, op: "add", domain: "example.com"))
        let twice = try #require(ConfigMerge.applyWhitelistOp(existing: once, op: "add", domain: "EXAMPLE.com"))

        let sleep = try jsonObject(twice)["sleep"] as? [String: Any]
        #expect(sleep?["whitelist"] as? [String] == ["mail.google.com", "example.com"])
    }

    @Test func whitelistRemoveDropsTheDomain() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let merged = try #require(
            ConfigMerge.applyWhitelistOp(existing: existing, op: "remove", domain: "mail.google.com")
        )
        let sleep = try #require(try jsonObject(merged)["sleep"] as? [String: Any])
        #expect(sleep["whitelist"] as? [String] == [])
    }

    /// A fresh file gets a well-formed `sleep` section seeded from defaults.
    @Test func whitelistOpOnFreshFileSeedsDefaults() throws {
        let merged = try #require(ConfigMerge.applyWhitelistOp(existing: nil, op: "add", domain: "example.com"))
        let out = try jsonObject(merged)
        let sleep = try #require(out["sleep"] as? [String: Any])

        #expect(sleep["whitelist"] as? [String] == ["example.com"])
        #expect(sleep["afterMinutes"] as? Int == 30)
        #expect(out["version"] as? Int == 2)
    }

    /// Garbage in, no write out: the host logs and drops instead of corrupting.
    @Test func whitelistOpRejectsUnknownOpAndEmptyDomain() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        #expect(ConfigMerge.applyWhitelistOp(existing: existing, op: "toggle", domain: "example.com") == nil)
        #expect(ConfigMerge.applyWhitelistOp(existing: existing, op: "add", domain: "   ") == nil)
    }

    @Test func normalizedDomainReducesInputToABareHost() {
        #expect(ConfigMerge.normalizedDomain("HTTPS://Example.com/foo?a=b#c") == "example.com")
        #expect(ConfigMerge.normalizedDomain("user:pw@Example.com:8443") == "example.com")
        #expect(ConfigMerge.normalizedDomain("  example.com  ") == "example.com")
        #expect(ConfigMerge.normalizedDomain("") == "")
    }
}
