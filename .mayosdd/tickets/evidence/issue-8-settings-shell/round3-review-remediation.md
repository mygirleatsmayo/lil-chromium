# Remediation review — Issue #8, fix round 1

Fixed point `d1578d5` and pre-fix `a3054d7` resolve. Delta `a3054d7..8a50540` is non-empty.

## 1. Ledger

- **S2** resolved — `+@MainActor` on `enum PalettePlacement`; `static var activeScreen` (the unverified `NSScreen.main` assertion) deleted.
- **S3** resolved — `.frame(width: 440, height: 520)` replaces `minWidth`/`minHeight`; clamp dropped: `return NSPoint(x: x, y: y)`.
- **P1** resolved — `frameAutosaveName = "LilChromiumSettings"`; `verified:` now: “This only guarantees first placement under an autosave name nothing has ever written to”.
- **P2** resolved — `guard let screen = OpenRouter.primaryScreen ?? NSScreen.main` (same source as `positionPanel`).

## 2. New findings

- None. The fix delta introduces no new defects.
