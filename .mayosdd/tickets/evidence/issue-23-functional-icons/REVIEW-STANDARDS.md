# Issue #23 — Standards review (initial)

- **Fixed point:** `411d47983443915c1fa67c77285471db309676d2`
- **Review head:** `bb3740de5f8d506da074c21e5f24a48f3c54095d` (`HEAD` matches)
- **Commits:** `bb3740d` feat(icons): issue #23 — normalize native and hoverbar functional icons

## Files / rules checked

Diff: `extension/overlay.js`, `extension/test/overlay-harness.js`, `extension/test/overlay.test.js`, `mac/Sources/LilChromiumApp/PaletteController.swift`, `mac/Sources/LilChromiumApp/SettingsWindow.swift`, `extension/assets/material-symbols/*`.

Rules: `AGENTS.md` / `CLAUDE.md`; chrome-extension (content scripts, WAR, UI surfaces); swiftui-expert (latest APIs, accessibility, view structure, macOS views, localization, soft-deprecation); swift-testing-pro (core, writing-better-tests); smell baseline.

## Findings

### 1. Low — Duplicated Code (judgment) — `SettingsWindow.swift` `generalSection`

Primary and Fallback each construct the same glyph chain: `Image(systemName: "exclamationmark.triangle.fill")`, `.symbolRenderingMode(.multicolor)`, then `.help` and `.accessibilityLabel` with the identical string.

Impact: warning tint or VoiceOver copy can drift between the two pickers. One small labeled-warning view would close the seam; two call sites are otherwise fine.

### 2. Low — Primitive Obsession (judgment) — `extension/test/overlay.test.js` copy-reset wait

`await new Promise((r) => setTimeout(r, 1300))` stands in for production `COPY_TICK_MS` (1200) plus slack.

Impact: ~1.3s wall clock; changing `COPY_TICK_MS` can fail the test or leave the revert unasserted. Drive the wait from the production constant or an injected timer.

## Documented rules — none broken

- No PROTOCOL, pinned-ID, manifest, or WAR edits. SVGs stay off `web_accessible_resources`; paths are inlined (chrome-extension WAR + `AGENTS.md` no-build-step).
- `PaletteController` / `SettingsWindowController` remain `@MainActor`. No new AppKit type. Existing `verified:` comments untouched.
- Overlay `ICON_PATHS` matches all six SVG `d` values; tests pin that contract. Not filed as duplication: extracting at runtime would need WAR or a build step.
- SwiftUI hunks: `Button`, private `@ScaledMetric`, dedicated `.accessibilityLabel`, no deprecated APIs. No Swift tests added — swift-testing-pro: do not test views.
- Lucas README / CHANGELOG untouched.

## Verification

Both refs resolve; `HEAD` equals review head; full range diff and one-line log read; `ICON_PATHS` compared to vendored SVGs (6/6 match). Did not re-run `swift test` / `pnpm test` (report-only).
