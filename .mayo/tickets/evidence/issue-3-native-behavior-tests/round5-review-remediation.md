# Remediation review — Issue #3, fix round 2

Pinned points resolve (`d1578d5`, `a8fac2a`). Delta `a8fac2a..557438a` is non-empty (3 files).

- **N1** resolved: `-    static func contextData(id: String = "ctx-1", browser: String = "brave", browserName: String = "Brave") throws -> Data {` — composition gone; `+        #expect(wire.keys.sorted() == [` pins PROTOCOL.md’s closed set (no `version`, no `paletteAnchor`).
- **N2** resolved: `+++ b/fixtures/message-context.json` — restored under repo-root `fixtures/` with the closed context keys and no `bundleId`; tests load `"message-context"` by name; `Fixture.contextData` deleted.

No new findings.

- Verification: `cd mac && swift test` → `Test run with 50 tests in 6 suites passed after 0.005 seconds.`
- Verification: `HOME` empty tmp → `Test run with 50 tests in 6 suites passed after 0.004 seconds.`; tmp contained only `.` / `..`. XCTest runner prints `Executed 0 tests` then Swift Testing runs the 50.

N1 and N2 are fully resolved. No new finding.
