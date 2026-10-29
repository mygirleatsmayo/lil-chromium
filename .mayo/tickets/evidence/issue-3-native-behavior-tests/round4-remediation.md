# Remediation round 2 — Issue #3 (N1, N2)

Branch: `surfx/remediation-round-2-issue-3-fix-the-rows-LOTK33pC`
Commit: `557438ae54a9cf27bb2ed5db926fee08a8823854` — `test(mac): restore shared message-context fixture (#3)`

## Ledger rows

| ID | Status | What changed | How verified |
|---|---|---|---|
| N1 | resolved | No separate change. Deleting `Fixture.contextData` (N2) removed the Swift composition that copied `version` and `paletteAnchor` onto the context wire. | Read `Fixture.swift`: `contextData` is gone. Observed: `contextCarriesConfigObjectsAndHostIdentity` asserts the fixture's top-level keys equal PROTOCOL.md's closed set (no `version`, no `paletteAnchor`) and passed. Production `ContextMessage` / `handleGetContext` already omit those keys — read the code path, not observed on a live host. |
| N2 | resolved | Restored `fixtures/message-context.json` (PROTOCOL.md closed context field set, no `bundleId`). Deleted `Fixture.contextData` and the unused `decode(_:from: Data)` overload. Context tests load the file by name. | Observed: `swift test` — `contextCarriesConfigObjectsAndHostIdentity`, `contextRoundTripsThroughEncoding`, `envelopeDecodesAnyMessageForDispatch` passed; fixture bytes contain no `bundleId`. Cross-language readability is the file's repo-root path (Issue #2 Testing Decision 4) — read the path, not observed against a Node/MV3 suite. |

Not acted on (settled): S1–S4, P1–P4.

## Verification

- `cd mac && swift test` — **pass**: `Test run with 50 tests in 6 suites passed after 0.004 seconds.`
- `cd mac && HOME=$(mktemp -d) swift test` — **pass**: `Test run with 50 tests in 6 suites passed after 0.004 seconds.` Temp HOME afterwards contained only `.` / `..`.
- `make app` — **succeeds**: `Done: .../mac/build/LilChromium.app`. `make install` not run.
