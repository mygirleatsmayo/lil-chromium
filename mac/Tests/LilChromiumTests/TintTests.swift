import Foundation
import Testing
@testable import LilChromiumApp
@testable import LilShared

/// Draft/commit boundaries for the shared tint editor, plus config round trips
/// of committed no-tint, preset, and custom values (Issue #11).
struct TintTests {

    // MARK: - Choice order

    @Test func choicesAreNoneThenPresetsThenCustom() {
        #expect(TintChoice.ordered.map(\.id) == [
            "none", "blue", "purple", "pink", "red", "orange", "yellow", "green",
            "graphite", "custom",
        ])
        #expect(TintChoice.ordered(offersNoTint: true) == TintChoice.ordered)
    }

    @Test func lilNapChoicesOmitNoTintAndKeepPresetOrder() {
        #expect(TintChoice.ordered(offersNoTint: false).map(\.id) == [
            "blue", "purple", "pink", "red", "orange", "yellow", "green",
            "graphite", "custom",
        ])
    }

    // MARK: - Hex completion

    @Test(arguments: [
        ("#f0a", "#ff00aa"),
        ("#FF00AA", "#ff00aa"),
        ("  #00ff00  ", "#00ff00"),
        ("#007aff", "#007aff"),
    ])
    func completedHexNormalizes(input: String, expected: String) {
        #expect(TintHex.normalize(input) == expected)
    }

    @Test(arguments: ["", "#", "#f", "#ff", "#fff0", "#gggggg", "ff00aa", "#ff00aag", "purple"])
    func incompleteOrInvalidHexDoesNotNormalize(input: String) {
        #expect(TintHex.normalize(input) == nil)
    }

    // MARK: - Draft vs committed

    @Test func emptyPartialAndInvalidDraftsKeepTheCommittedColor() {
        var model = TintEditorModel.seeded(from: "#3311aa")
        #expect(model.isCustom)
        #expect(model.selectedChoice == .custom)

        for draft in ["", "#", "#3", "#33", "#3311a", "#zzzzzz", "3311aa"] {
            model.applyDraft(draft)
            #expect(model.committed == "#3311aa", "draft \(draft) must not un-commit")
            #expect(model.draft == draft)
            #expect(model.isCustom, "the custom editor stays up for draft \(draft)")
        }
    }

    @Test func onlyAValidCompletedDraftCommits() {
        var model = TintEditorModel.seeded(from: "#3311aa")
        model.applyDraft("#007A")
        #expect(model.committed == "#3311aa")
        model.applyDraft("#007AFF")
        #expect(model.committed == "#007aff")
        #expect(model.draft == "#007AFF")
        #expect(model.isCustom)
    }

    @Test func choosingNoTintCommitsNilWithoutRequiringADraft() {
        var model = TintEditorModel.seeded(from: TintPreset.blue.hex)
        model.select(.none)
        #expect(model.committed == nil)
        #expect(model.draft == "")
        #expect(model.isCustom == false)
        #expect(model.selectedChoice == .none)
    }

    @Test func customFromNoTintKeepsNilAndStaysEditable() {
        var model = TintEditorModel.seeded(from: nil)
        model.select(.custom)
        #expect(model.committed == nil)
        #expect(model.isCustom)
        #expect(model.selectedChoice == .custom)
        model.applyDraft("#ff")
        #expect(model.committed == nil, "partial custom draft is not a color")
        #expect(model.isCustom)
    }

    @Test func presetCommitIsThatPresetsHex() {
        var model = TintEditorModel.seeded(from: nil)
        model.select(.preset(.orange))
        #expect(model.committed == TintPreset.orange.hex)
        #expect(model.selectedChoice == .preset(.orange))
        #expect(model.isCustom == false)
    }

    @Test func typingAPresetHexWhileCustomKeepsTheEditorOpen() {
        var model = TintEditorModel.seeded(from: "#3311aa")
        model.applyDraft(TintPreset.blue.hex)
        #expect(model.committed == TintPreset.blue.hex)
        #expect(model.isCustom)
        #expect(model.selectedChoice == .custom)
    }

    @Test func pickerHexSelectsCustomAndCommits() {
        var model = TintEditorModel.seeded(from: TintPreset.green.hex)
        model.applyPickerHex("#AbCdEf")
        #expect(model.committed == "#abcdef")
        #expect(model.draft == "#abcdef")
        #expect(model.selectedChoice == .custom)
    }

    @Test func seedTreatsPresetHexAsThatChipNotCustom() {
        let model = TintEditorModel.seeded(from: TintPreset.pink.hex)
        #expect(model.selectedChoice == .preset(.pink))
        #expect(model.isCustom == false)
    }

    @Test func reseedRestoresDraftFromCommitted() {
        var model = TintEditorModel.seeded(from: "#112233")
        model.applyDraft("#")
        model.seed(from: "#112233")
        #expect(model.draft == "#112233")
        #expect(model.committed == "#112233")
        #expect(model.isCustom)
    }

    // MARK: - Config field mapping

    @Test func sleepNamedTokensDisplayAsChips() {
        #expect(TintValue.committedHex(fromSleep: "purple") == TintPreset.purple.hex)
        #expect(TintValue.committedHex(fromSleep: "gray") == TintPreset.graphite.hex)
        #expect(TintValue.committedHex(fromSleep: "grey") == TintPreset.graphite.hex)
        #expect(TintValue.committedHex(fromSleep: "#3311AA") == "#3311aa")
    }

    @Test func sleepNilOrEmptyCommitStoresGraphiteHex() {
        #expect(TintValue.sleepStorage(fromCommitted: nil) == TintPreset.graphite.hex)
        #expect(TintValue.sleepStorage(fromCommitted: "") == TintPreset.graphite.hex)
        #expect(TintValue.sleepStorage(fromCommitted: TintPreset.blue.hex) == TintPreset.blue.hex)
        #expect(TintValue.sleepStorage(fromCommitted: nil).isEmpty == false)
    }

    @Test func unusableSleepTintIsNotCommittedGraphite() {
        #expect(TintValue.committedHex(fromSleep: "") == nil)
        #expect(TintValue.committedHex(fromSleep: "none") == nil)
    }

    /// Binding skip: empty/`"none"` are not graphite, so selecting the
    /// displayed graphite chip writes `#8e8e93`. `sleepStorage` alone would
    /// already return that hex; the skip is what used to drop the write.
    @Test(arguments: ["", "none"])
    func selectingGraphiteRewritesUnusableSleepTint(onDisk: String) throws {
        var cfg = LilConfig.defaults
        cfg.sleep.tint = onDisk
        let stored = try #require(TintValue.sleepTintIfChanged(
            from: cfg.sleep.tint, committing: TintPreset.graphite.hex
        ))
        cfg.sleep.tint = stored
        #expect(cfg.sleep.tint == TintPreset.graphite.hex)
    }

    @Test(arguments: [
        "gray",
        "grey",
        "purple",
        TintPreset.graphite.hex,
        "#3311aa",
    ])
    func selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk: String) {
        let displayed = TintValue.committedHex(fromSleep: onDisk)
            ?? TintPreset.graphite.hex
        #expect(TintValue.sleepTintIfChanged(from: onDisk, committing: displayed) == nil)
    }

    @Test func hoverBarNilIsNoTint() {
        #expect(TintValue.committedHex(fromHoverBar: nil) == nil)
        #expect(TintValue.hoverBarStorage(fromCommitted: nil) == nil)
        #expect(TintValue.hoverBarStorage(fromCommitted: "#FF2D55") == TintPreset.pink.hex)
    }

    /// Displaying `"purple"` as the purple chip must not be treated as a
    /// storage rewrite: `sleepStorage` of that hex is `#af52de`, not the named
    /// token. Settings skips the write when the displayed hex is unchanged.
    @Test func displayedSleepNamedTokenIsNotTheStoredToken() {
        let stored = "purple"
        let displayed = TintValue.committedHex(fromSleep: stored)
        #expect(displayed == TintPreset.purple.hex)
        #expect(TintValue.sleepStorage(fromCommitted: displayed) == TintPreset.purple.hex)
        #expect(TintValue.sleepStorage(fromCommitted: displayed) != stored)
    }

    // MARK: - Config round trips (additive decode, normalized encode)

    @Test func hoverBarNoTintRoundTripsAsOmittedKey() throws {
        var cfg = LilConfig.defaults
        cfg.hoverBar.tint = TintValue.hoverBarStorage(fromCommitted: nil)
        let data = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: cfg))
        let decoded = try JSONDecoder().decode(LilConfig.self, from: data)
        #expect(decoded.hoverBar.tint == nil)
        let hoverBar = try #require(try jsonObject(data)["hoverBar"] as? [String: Any])
        #expect(hoverBar["tint"] == nil)
        let text = try #require(String(data: data, encoding: .utf8))
        #expect(text.contains("null") == false)
    }

    @Test func hoverBarPresetAndCustomHexRoundTrip() throws {
        var cfg = LilConfig.defaults
        cfg.hoverBar.tint = TintValue.hoverBarStorage(fromCommitted: TintPreset.blue.hex)
        let presetData = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: cfg))
        let presetDecoded = try JSONDecoder().decode(LilConfig.self, from: presetData)
        #expect(presetDecoded.hoverBar.tint == TintPreset.blue.hex)

        cfg.hoverBar.tint = TintValue.hoverBarStorage(fromCommitted: "#3311aa")
        let customData = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: cfg))
        let customDecoded = try JSONDecoder().decode(LilConfig.self, from: customData)
        #expect(customDecoded.hoverBar.tint == "#3311aa")
    }

    @Test func sleepPresetAndCustomHexRoundTrip() throws {
        var cfg = LilConfig.defaults
        cfg.sleep.tint = TintValue.sleepStorage(fromCommitted: TintPreset.green.hex)
        let presetData = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: cfg))
        let presetDecoded = try JSONDecoder().decode(LilConfig.self, from: presetData)
        #expect(presetDecoded.sleep.tint == TintPreset.green.hex)

        cfg.sleep.tint = TintValue.sleepStorage(fromCommitted: "#3311aa")
        let customData = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: cfg))
        let customDecoded = try JSONDecoder().decode(LilConfig.self, from: customData)
        #expect(customDecoded.sleep.tint == "#3311aa")
    }

    @Test func sleepNilCommitRoundTripsAsGraphiteHex() throws {
        var cfg = LilConfig.defaults
        cfg.sleep.tint = TintValue.sleepStorage(fromCommitted: nil)
        let data = try #require(ConfigMerge.mergedJSONData(existing: nil, applying: cfg))
        let decoded = try JSONDecoder().decode(LilConfig.self, from: data)
        #expect(decoded.sleep.tint == TintPreset.graphite.hex)
        #expect(decoded.sleep.tint != "")
        #expect(decoded.sleep.tint != SleepConfig.defaults.tint)
        #expect(TintValue.committedHex(fromSleep: decoded.sleep.tint) == TintPreset.graphite.hex)
        let sleep = try #require(try jsonObject(data)["sleep"] as? [String: Any])
        #expect(sleep["tint"] as? String == TintPreset.graphite.hex)
    }

    @Test func legacySleepNamedTokensStillDecode() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v1-legacy")
        #expect(cfg.sleep.tint == "purple")
        #expect(TintValue.committedHex(fromSleep: cfg.sleep.tint) == TintPreset.purple.hex)
    }

    @Test func tintWritePreservesUnknownFieldsAndStableEncoding() throws {
        let existing = try Fixture.data("config-with-unknown-fields")
        var cfg = try JSONDecoder().decode(LilConfig.self, from: existing)
        cfg.sleep.tint = TintValue.sleepStorage(fromCommitted: TintPreset.orange.hex)
        cfg.hoverBar.tint = TintValue.hoverBarStorage(fromCommitted: TintPreset.pink.hex)

        let first = try #require(ConfigMerge.mergedJSONData(existing: existing, applying: cfg))
        let second = try #require(ConfigMerge.mergedJSONData(existing: first, applying: cfg))
        #expect(first == second, "an unchanged tint save must be byte-identical")

        let out = try jsonObject(first)
        let probe = try #require(out["unknownSectionProbe"] as? [String: Any])
        #expect(probe["someNumber"] as? Int == 24)
        #expect(probe["someFlag"] as? Bool == true)
        let sleep = try #require(out["sleep"] as? [String: Any])
        #expect(sleep["tint"] as? String == TintPreset.orange.hex)
        let hoverBar = try #require(out["hoverBar"] as? [String: Any])
        #expect(hoverBar["tint"] as? String == TintPreset.pink.hex)
    }
}
