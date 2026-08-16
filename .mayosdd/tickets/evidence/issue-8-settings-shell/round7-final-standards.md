# Standards review

No findings.

`git diff main...HEAD` (7 files: `docs/PROTOCOL.md`, `AppDelegate.swift`, `MainMenu.swift`, `PaletteController.swift`, `PalettePanel.swift`, `PalettePlacement.swift`, `SettingsWindow.swift`) meets `AGENTS.md`, `docs/PROTOCOL.md`, `CONTEXT.md` / `docs/adr/`, and the frozen Issue #8 ledger.

Checked and not re-filed: **S1/P3** Window menu (won't-fix); **S2** `@MainActor` on `PalettePlacement`; **S3**/ **F1** one `SettingsPaneSize` (440×520) for `contentRect`, `setContentSize` after `NSHostingController`, and `SettingsRoot.frame`, clamp gone; **P1** autosave `LilChromiumSettings`; **P2** `OpenRouter.primaryScreen` for both surfaces. Palette closes in `showSettings()` (settled interpretation 1). AppKit types added or annotated in this diff are `@MainActor`. `verified:` comments match the code they describe.

Fowler smells in the hunks are suppressed where the repo/ledger endorses them (duplicated status-item vs application menu; fixed Settings size; undrawn `LSUIElement` menu). Pre-existing `ObservableObject` / `Binding(get:set:)` / 1-parameter `onChange` (macOS 13 in `mac/Package.swift`) are out of scope or overridden.
