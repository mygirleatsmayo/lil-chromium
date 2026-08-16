# Remediation review — Issue #3, fix round 1

Pinned points resolve (`d1578d5`, `ebac1d5`). Delta `ebac1d5..96417a3` is non-empty (16 files).

- **S1** resolved: `+    @Test func unchangedSaveKeepsUnknownFieldsVerbatim() throws {` — nested whole-replace pin is gone; PROTOCOL.md is not in the delta.
- **S2** resolved: `deleted file mode 100644` `mac/Tests/LilChromiumTests/Fixtures/message-context.json` — nested `sleep`/`searchEngine`/`hoverBar` now live only in `config-v2-complete.json`; `Fixture.contextData` composes the context wire.
- **S4** resolved: `+// swift-tools-version:6.0` — `.swiftLanguageMode(.v5)` on all four targets; suites are structs with `@Test` / `#expect` / `#require`; no XCTest left in `mac/Tests/`.
- **P2** resolved: `+  "unknownSectionProbe": {` — `lilNap.revealZonePx` / `restorePriorContext` gone; nested `wakeFeedback` renamed `unknownNestedProbe`.
- **P3** resolved: `rename to fixtures/config-v2-complete.json` — fixtures at repo-root `fixtures/`; `resources: [.copy("Fixtures")]` removed; load via `#filePath`.
- **N1** needs adjudication: `var wire = try jsonObject(data("config-v2-complete"))` copies every config key onto the synthetic context wire (`version`, `paletteAnchor` remain). PROTOCOL.md lists a closed context field set that omits those keys, and also says context carries “the full config objects verbatim.” Codable ignores extras, so tests still pass. Not a failure.

Verification: `cd mac && swift test` → `Test run with 50 tests in 6 suites passed after 0.004 seconds.` `HOME` empty tmp → same pass; tmp still empty (`.` / `..` only). XCTest runner prints `Executed 0 tests` then Swift Testing runs the 50.

Ledger S1/S2/S4/P2/P3 are fully resolved. Worst new item is N1 (adjudication only; no new defect of failure severity).
