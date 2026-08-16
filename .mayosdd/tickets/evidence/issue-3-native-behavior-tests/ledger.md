# Findings ledger — Issue #3: Establish native behavior tests and shared contract fixtures

- **Branch:** `v0.4/issue-3-native-tests`
- **Worktree:** `/Users/mygirleatsmayo/projects/lil-chromium-i3`
- **Fixed point:** `d1578d5`
- **HEAD at round 1:** `1f049ae`
- **Status:** FROZEN — adjudicated by Lucas 2026-08-16. Remediation may act on this file and nothing else.

## Rounds

| Round | Mode | Reviewer | Tasks |
|---|---|---|---|
| 1 | Full | `cursor` / `cursor-grok-4.6-xhigh` | `xAWZHEty` Standards, `xbP06ufb` Spec |

## Ledger

| ID | Verdict | Location | Finding | Required outcome |
|---|---|---|---|---|
| S1 | **relax test** | `ConfigMergeTests.swift` · `testSaveReplacesOwnedNestedObjectsWhole` | The test pins nested whole-object replacement as contract. `docs/PROTOCOL.md` promises only that unknown fields survive a rewrite. | Narrow the test to assert what PROTOCOL.md actually promises. Do **not** add the nested rule to PROTOCOL.md. |
| S2 | **fix** | `Fixtures/config-v2-complete.json`, `Fixtures/message-context.json` | Duplicated Code — the same nested `sleep` / `searchEngine` / `hoverBar` objects are copied across two fixtures, against the ticket's own no-duplication criterion. | One fixture expresses each contract meaning once. |
| S3 | **won't-fix** | `ConfigTests.swift` comment | Reviewer claimed "Lil Nap" is not a project term. | Premise refuted: `CONTEXT.md:43` defines it. No action. |
| S4 | **fix** (manager finding, not from round 1) | `mac/Package.swift`, all of `mac/Tests/` | Suite is XCTest. The round-1 author said Swift Testing needs tools-version 6.0, which would force Swift 6 language mode. Only the first half is true. | Bump to `swift-tools-version:6.0` and keep Swift 5 semantics with `.swiftLanguageMode(.v5)` in the target's `swiftSettings`. Migrate the suite to Swift Testing. Cheapest now, at 50 tests one day old. |
| P1 | **won't-fix** | palette ranking / Return modifiers | Issue #2 Testing Decision 2 lists ranking and action selection. | **Settled interpretation:** #2's Testing Decisions describe the end state of the native seam across all of v0.4, not one ticket's scope. #3's acceptance criteria are #3's scope. #13 owns deterministic ranking, #14 owns Return modifiers. Writing them now would pin v0.3 behavior that #2 says v0.4 supersedes. No later round may re-raise this. |
| P2 | **fix** | `Fixtures/config-with-unknown-fields.json` | Invents top-level `lilNap.revealZonePx` and `restorePriorContext`. No ticket has settled those wire keys, and the real hover-bar field nests under `hoverBar`. | The unknown-field probe must use a shape that cannot be mistaken for a settled contract. |
| P3 | **fix** | `mac/Tests/LilChromiumTests/Fixtures/` | Issue #2 Testing Decision 4: fixtures are shared at the app/host/extension boundary, and both language suites assert against the same contract meanings. They currently sit inside the Swift test bundle only. | Move to a location the Node/MV3 suite (Issue #4) can also read. Swift target loads them from there. |
| P4 | **won't-fix** | prior-context payloads | Same as P1. #15 owns prior-context restoration. | Covered by the P1 settled interpretation. |

## Carried, accepted

`OpenRouter.launchBundleIds` drops a `knownBrowsers` entry with an empty `bundleId` when the candidate list is built, instead of attempting it and failing the Launch Services lookup. Same end result, one step earlier. Accepted by Lucas 2026-08-15.

## Raw reports

`raw/issue-3-round1-standards-xAWZHEty.md`, `raw/issue-3-round1-spec-xbP06ufb.md`
