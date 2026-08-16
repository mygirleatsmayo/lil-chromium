# Remediation round 1 — Issue #8

| ID | Status | Change | Verification |
|---|---|---|---|
| S2 | resolved | `PalettePlacement` annotated `@MainActor`; `PaletteController` annotated too (its `positionPanel`/`paletteAnchorCoords` call into `PalettePlacement`, and it is equally AppKit-touching per `AGENTS.md`). The `NSScreen.main` menu-bar assertion in `activeScreen` was dropped by deleting `activeScreen` itself (dead after P2) — I could not verify it on a real system without opening a window, so no `verified:` marker was written. | Read the code path; `make app` release build passes with the Swift 6.2 toolchain, which would hard-error on isolation violations. |
| S3 | resolved | `SettingsRoot` frame changed from `.frame(minWidth: 440, minHeight: 520)` to a fixed `.frame(width: 440, height: 520)`, so `NSHostingController` can no longer grow the window with content; the `max(y, vf.minY)` clamp in `centeredOrigin(forSize:on:)` removed — the 20% top-edge rule now holds unconditionally. The documented rule in `docs/PROTOCOL.md` did not change (the code now matches it), so no placement-rule edit was needed for this row. | Read the code path: styleMask has no `.resizable`, and with a fixed SwiftUI frame the size passed to `centeredOrigin` is constant, so no nudge case remains. Not observed in a running window (focus constraint). |
| P1 | resolved | Frame autosave name changed `"SettingsWindow"` → `"LilChromiumSettings"` (confirmed `d1578d5:SettingsWindow.swift:39` already used the old name, so a stored frame suppressed first placement). The `verified:` comment was corrected: the probed AppKit mechanics are kept, but it now states the ordering only guarantees first placement under a name nothing has ever written. | Confirmed the v0.3 name collision via `git show d1578d5:...`. Effect of the new name (fresh defaults key) is read-the-code-path reasoning, not observed. |
| P2 | resolved | `placeNearCenteredPalette` now uses `OpenRouter.primaryScreen ?? NSScreen.main` — the same source as `PaletteController.positionPanel` — instead of `PalettePlacement.activeScreen` (deleted). `docs/PROTOCOL.md` Placement (v4) updated in the same commit: "display under the pointer" → "primary display", and autosave name updated to `LilChromiumSettings`. | Read both call sites to confirm a single screen source. Not observed on a multi-display desk. |

No ledger row required changes outside the ledger's scope; nothing is marked `needs adjudication`. Rows S1/P3 (Window menu) untouched as instructed.

## Build

`make app` succeeded (exit 0): `swift build -c release` — "Build complete! (9.67 sec)", bundle assembled at `mac/build/LilChromium.app`, ad-hoc codesigned, registered with Launch Services. No tests exist on this branch; none added.

## Commit

`8a50540af7806b25cd98ed44804ea035593dff6e` — `fix(app): remediate settings-shell review round 1 (#8)` on branch `surfx/remediation-round-1-issue-8-fix-the-find-cFxEvdBF`. Not pushed; no PR; issue left open. `CONTEXT.md`, `docs/adr/`, and the ledger file were not committed.
