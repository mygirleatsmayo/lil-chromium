# Remediation round 1 — Issue #3

Branch: `surfx/remediation-round-1-issue-3-fix-the-find-GZLq8Dey`
Commit: `96417a3` — `test(mac): remediate round-1 review ledger (#3)`

## Ledger rows

| ID | Status | What changed |
|---|---|---|
| S1 | resolved | `testSaveReplacesOwnedNestedObjectsWhole` replaced by `unchangedSaveKeepsUnknownFieldsVerbatim` (`ConfigMergeTests.swift`): asserts only PROTOCOL.md's promise (unknown top-level fields survive a rewrite, values intact); the nested whole-replace pinning is gone, and PROTOCOL.md was not touched. |
| S2 | resolved | Deleted `message-context.json`. `Fixture.contextData()` composes context wire bytes from `config-v2-complete.json` + host identity (knownBrowsers trimmed of `bundleId`), so each contract meaning lives in exactly one fixture; the context tests now assert verbatim carriage against the decoded config fixture plus a `bundleId`-free wire check. |
| S4 | resolved | `mac/Package.swift`: `swift-tools-version:6.0`, `.swiftLanguageMode(.v5)` in `swiftSettings` (applied to all four targets so the bump keeps production targets on Swift 5 semantics too). All six test files migrated to Swift Testing (struct suites, `@Test`, `#expect`/`#require`, no `test` prefixes); `Fixture.jsonObject` now throws `Fixture.NotJSONObject` instead of `XCTUnwrap`. |
| P2 | resolved | `config-with-unknown-fields.json`: top-level `lilNap.{revealZonePx,restorePriorContext}` replaced with `unknownSectionProbe.{someNumber,someFlag}`; nested `sleep.wakeFeedback` renamed `sleep.unknownNestedProbe` (Issue #2 names "wake feedback" as a real upcoming feature, so it was equally mistakable for a settled key). Test references updated. |
| P3 | resolved | Fixtures moved from `mac/Tests/LilChromiumTests/Fixtures/` to repo-root `fixtures/` (readable by the Issue #4 Node/MV3 suite). `Fixture` loads them via `#filePath`-relative repo root instead of `Bundle.module`; `resources: [.copy("Fixtures")]` removed from the test target; `AGENTS.md` fixture path updated. |

Not acted on (settled won't-fix): S3, P1, P4.

## Verification

- `cd mac && swift test` — **pass**: "Test run with 50 tests in 6 suites passed after 0.005 seconds." (Swift Testing runner; no XCTest runner remains.)
- `cd mac && HOME=$(mktemp -d) swift test` — **pass**: "Test run with 50 tests in 6 suites passed after 0.004 seconds." The temp HOME directory was still empty afterwards (`ls -a` shows only `.`/`..`), proving the suite reads no home-directory state (fixtures resolve via `#filePath`, not `~`).
- `make app` — **succeeds**: release build + bundle produced at `mac/build/LilChromium.app` ("Done: .../mac/build/LilChromium.app"). `make install` not run, per constraints.
