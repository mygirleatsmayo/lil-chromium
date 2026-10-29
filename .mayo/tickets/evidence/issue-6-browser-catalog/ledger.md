# Findings ledger — Issue #6: Catalog every supported browser installation

Branch `v0.4/issue-6-browser-catalog`. Fixed point `main` @ `4a4ada8`. Code at `eeeee14`.

Round 1 review: Standards `icffUT9g`, Spec `hAQatqjK`. Both returned **No findings**.

## Findings

None.

## Manager verification

Both reports were terse, so the criteria most open to faking were checked directly:

| Criterion | Check | Result |
|---|---|---|
| 1 — exact installation set | slugs in `mac/Sources/LilShared/Browsers.swift` | 22 slugs, matching the issue list item for item: chrome/-beta/-dev/-canary, brave/-beta/-dev/-nightly, edge/-beta/-dev/-canary, vivaldi/-snapshot, opera/-gx/-developer, helium, arc, dia, comet, chromium |
| 4 — profiles never routing targets | `NativeHostManifestTests.profileDirectoriesAreNeverInstallTargets` runs the real script against a scratch `HOME` containing `Google/Chrome/Default` and `Google/Chrome/Profile 1` | met |
| 5 — one catalog everywhere | `scripts/install-host.sh:54` keeps its own list, unavoidable in shell — but `NativeHostManifestTests.installScriptListsTheFullCatalog` asserts `browserDirs(inInstallScript:) == BrowserTable.nativeHostSupportDirectories` | met; the duplication is machine-enforced, not drift |
| 6 — automated checks | `BrowserCatalogTests`, `BrowserTableTests`, `NativeHostManifestTests` added | met; `swift test` → 69 tests, 9 suites |

## Settled interpretations

1. A hardcoded list inside `scripts/install-host.sh` is acceptable **only** while a test pins it to `BrowserTable`. Removing that test reopens criterion 5.
2. This change touched `mac/`, `docs/PROTOCOL.md`, and the host together, satisfying the `AGENTS.md` three-component rule.

## Verdict

Ledger empty at round 1. No remediation round required.
