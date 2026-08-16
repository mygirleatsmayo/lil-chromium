import XCTest
@testable import LilShared

/// The read-merge-write contract for `config.json`: every writer (app AND host)
/// preserves fields it does not own, and writes normalized bytes.
/// See docs/PROTOCOL.md, "Config file".
final class ConfigMergeTests: XCTestCase {

    /// A v0.4 writer may add top-level sections (here: `lilNap`) a v0.3 writer
    /// has never heard of. Saving from the older model must not delete them.
    func testSavePreservesUnknownTopLevelFields() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        var cfg = try JSONDecoder().decode(LilConfig.self, from: existing)
        cfg.defaultBrowser = "brave"

        let merged = try XCTUnwrap(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let out = try jsonObject(merged)

        // Owned key rewritten.
        XCTAssertEqual(out["defaultBrowser"] as? String, "brave")
        // Unowned section untouched, values and all.
        let lilNap = try XCTUnwrap(out["lilNap"] as? [String: Any])
        XCTAssertEqual(lilNap["revealZonePx"] as? Int, 24)
        XCTAssertEqual(lilNap["restorePriorContext"] as? Bool, true)
    }

    /// Ownership is per top-level key: a writer that owns `sleep` owns all of it,
    /// so a full save replaces the object whole rather than deep-merging.
    func testSaveReplacesOwnedNestedObjectsWhole() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let cfg = try JSONDecoder().decode(LilConfig.self, from: existing)

        let merged = try XCTUnwrap(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let sleep = try XCTUnwrap(try jsonObject(merged)["sleep"] as? [String: Any])

        XCTAssertNil(sleep["wakeFeedback"], "sleep is owned whole — unknown sub-keys do not survive a full save")
        XCTAssertEqual(sleep["afterMinutes"] as? Int, 30)
    }

    /// With no file on disk yet, the merge is just the encoded config.
    func testSaveFromNoExistingFileWritesTheConfig() throws {
        let merged = try XCTUnwrap(ConfigMerge.mergedJSONData(existing: nil, applying: .defaults))
        let out = try jsonObject(merged)

        XCTAssertEqual(out["version"] as? Int, 2)
        XCTAssertEqual(out["defaultBrowser"] as? String, "helium")
        XCTAssertEqual(out["linkBehavior"] as? String, "new-lil")
    }

    /// Corrupt bytes on disk must not block a rewrite (the file is never
    /// load-bearing enough to wedge a writer).
    func testSaveOverCorruptFileStillWrites() throws {
        let merged = try XCTUnwrap(
            ConfigMerge.mergedJSONData(existing: Data("not json".utf8), applying: .defaults)
        )
        XCTAssertEqual(try jsonObject(merged)["defaultBrowser"] as? String, "helium")
    }

    // MARK: - Normalized encoding

    /// Written bytes are normalized: sorted keys, pretty-printed, and stable
    /// across identical saves so the file does not churn.
    func testWrittenBytesAreSortedAndStable() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let cfg = try JSONDecoder().decode(LilConfig.self, from: existing)

        let first = try XCTUnwrap(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let second = try XCTUnwrap(ConfigMerge.mergedJSONData(existing: first, applying: cfg))
        XCTAssertEqual(first, second, "an unchanged save must be byte-identical")

        let text = try XCTUnwrap(String(data: first, encoding: .utf8))
        let keyOrder = ["defaultBrowser", "ephemeralDefault", "fallbackBrowser", "hoverBar",
                        "knownBrowsers", "lilNap", "linkBehavior", "paletteAnchor",
                        "searchEngine", "sleep", "version"]
        let offsets = keyOrder.compactMap { text.range(of: "\"\($0)\"")?.lowerBound }
        XCTAssertEqual(offsets.count, keyOrder.count, "every top-level key is present")
        XCTAssertEqual(offsets, offsets.sorted(), "top-level keys are written in sorted order")
        XCTAssertTrue(text.contains("\n"), "config.json is pretty-printed for humans")
    }

    /// An absent optional is absent from the file — never an explicit null.
    func testAbsentHoverBarTintIsOmittedNotNull() throws {
        let merged = try XCTUnwrap(ConfigMerge.mergedJSONData(existing: nil, applying: .defaults))
        let hoverBar = try XCTUnwrap(try jsonObject(merged)["hoverBar"] as? [String: Any])

        XCTAssertEqual(hoverBar["style"] as? String, "glass")
        XCTAssertNil(hoverBar["tint"])
        XCTAssertFalse(
            try XCTUnwrap(String(data: merged, encoding: .utf8)).contains("null"),
            "no field is ever written as an explicit null"
        )
    }

    // MARK: - whitelist-op (host-side edit)

    /// The host's `whitelist-op` is a surgical edit: it touches only
    /// `sleep.whitelist` and preserves unknown keys anywhere else — including
    /// inside `sleep` itself, which a full save would replace.
    func testWhitelistAddPreservesEverythingElse() throws {
        let existing = try Fixture.data("config-with-unknown-fields")

        let merged = try XCTUnwrap(
            ConfigMerge.applyWhitelistOp(existing: existing, op: "add", domain: "https://News.YCombinator.com/newest")
        )
        let out = try jsonObject(merged)
        let sleep = try XCTUnwrap(out["sleep"] as? [String: Any])

        // Domains are normalized to a bare lowercased host.
        XCTAssertEqual(sleep["whitelist"] as? [String], ["mail.google.com", "news.ycombinator.com"])
        // Unknown keys survive — both nested and top-level.
        XCTAssertEqual(sleep["wakeFeedback"] as? String, "chime")
        XCTAssertNotNil(out["lilNap"])
        XCTAssertEqual(out["version"] as? Int, 3, "a host edit never downgrades the schema version")
    }

    func testWhitelistAddIsIdempotent() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let once = try XCTUnwrap(ConfigMerge.applyWhitelistOp(existing: existing, op: "add", domain: "example.com"))
        let twice = try XCTUnwrap(ConfigMerge.applyWhitelistOp(existing: once, op: "add", domain: "EXAMPLE.com"))

        XCTAssertEqual(try jsonObject(twice)["sleep"].flatMap { ($0 as? [String: Any])?["whitelist"] as? [String] },
                       ["mail.google.com", "example.com"])
    }

    func testWhitelistRemoveDropsTheDomain() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        let merged = try XCTUnwrap(
            ConfigMerge.applyWhitelistOp(existing: existing, op: "remove", domain: "mail.google.com")
        )
        let sleep = try XCTUnwrap(try jsonObject(merged)["sleep"] as? [String: Any])
        XCTAssertEqual(sleep["whitelist"] as? [String], [])
    }

    /// A fresh file gets a well-formed `sleep` section seeded from defaults.
    func testWhitelistOpOnFreshFileSeedsDefaults() throws {
        let merged = try XCTUnwrap(ConfigMerge.applyWhitelistOp(existing: nil, op: "add", domain: "example.com"))
        let out = try jsonObject(merged)
        let sleep = try XCTUnwrap(out["sleep"] as? [String: Any])

        XCTAssertEqual(sleep["whitelist"] as? [String], ["example.com"])
        XCTAssertEqual(sleep["afterMinutes"] as? Int, 30)
        XCTAssertEqual(out["version"] as? Int, 2)
    }

    /// Garbage in, no write out: the host logs and drops instead of corrupting.
    func testWhitelistOpRejectsUnknownOpAndEmptyDomain() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        XCTAssertNil(ConfigMerge.applyWhitelistOp(existing: existing, op: "toggle", domain: "example.com"))
        XCTAssertNil(ConfigMerge.applyWhitelistOp(existing: existing, op: "add", domain: "   "))
    }

    func testNormalizedDomainReducesInputToABareHost() {
        XCTAssertEqual(ConfigMerge.normalizedDomain("HTTPS://Example.com/foo?a=b#c"), "example.com")
        XCTAssertEqual(ConfigMerge.normalizedDomain("user:pw@Example.com:8443"), "example.com")
        XCTAssertEqual(ConfigMerge.normalizedDomain("  example.com  "), "example.com")
        XCTAssertEqual(ConfigMerge.normalizedDomain(""), "")
    }
}
