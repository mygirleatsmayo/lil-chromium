# Findings ledger — Issue #8: Give Settings a conventional macOS shell

- **Branch:** `v0.4/issue-8-settings-shell`
- **Worktree:** `/Users/mygirleatsmayo/projects/lil-chromium-i8`
- **Fixed point:** `d1578d5`
- **HEAD at round 1:** `a3054d7`
- **Status:** FROZEN — adjudicated by Lucas 2026-08-16. Remediation may act on this file and nothing else.

## Rounds

| Round | Mode | Reviewer | Tasks |
|---|---|---|---|
| 1 | Full | `cursor` / `cursor-grok-4.6-xhigh` | `TBAKi6uM` Standards, `nvQGlrPO` Spec |

## Ledger

| ID | Verdict | Location | Finding | Required outcome |
|---|---|---|---|---|
| S1 / P3 | **won't-fix — keep the Window menu** | `MainMenu.swift:77,80` | Reviewers called the Window menu (⌘M, ⌘W) a new palette dismissal path and scope creep. | **Settled interpretation:** the Settings window's styleMask is `[.titled, .closable, .miniaturizable, .fullSizeContentView]`, so ⌘W and ⌘M are correct and wanted there. The palette panel is `[.borderless, .nonactivatingPanel, .fullSizeContentView]` — neither closable nor miniaturizable — so `performClose:` cannot dismiss it. Lucas keeps the menu. No later round may fail this. |
| S2 | **fix** | `PalettePlacement.swift:8` | The new enum touches AppKit (`NSEvent.mouseLocation`, `NSScreen`, `NSMouseInRect`) with no `@MainActor`. `MainMenu` in the same diff is annotated at line 17. `AGENTS.md` requires it. | Annotate it. Add a `verified:` marker for the `NSScreen.main` menu-bar assertion in `activeScreen`, or drop the assertion. |
| S3 | **fix the size, not the clamp** | `PalettePlacement.centeredOrigin(forSize:on:)` · `SettingsWindow.swift:43,193` | `max(y, vf.minY)` nudges a tall window up, so its top edge is no longer at 20% of `visibleFrame`, contradicting `docs/PROTOCOL.md` Placement (v4). | The window has no `.resizable` in its styleMask, so the user cannot resize it. Height varies only because `.frame(minWidth:minHeight:)` is a *minimum* and `NSHostingController` sizes to fit content. Give Settings a defined size. Then remove the clamp — the 20% rule holds unconditionally. |
| P1 | **fix** | `SettingsWindow.swift:62` | `setFrameUsingName("SettingsWindow")` runs first and only places the window when it returns false. **v0.3 used the same autosave name** (`d1578d5:SettingsWindow.swift:39`). AppKit writes the frame on close even when the user never moved the window, so a stored frame already exists and the new placement never runs. The `verified:` comment claiming the ordering protects first placement is wrong. | Use a new autosave name. Lucas is the only user, so no migration or compatibility shim is needed. Correct the `verified:` comment. |
| P2 | **fix** | `SettingsWindow.swift:74` vs `PaletteController.swift:222,354` | Settings uses `PalettePlacement.activeScreen` (display under the pointer). The palette uses `OpenRouter.primaryScreen`. On a multi-display desk the first Settings frame is not near the actual centered palette. | One screen source for both. The ticket says "near the centered palette position", so Settings follows the palette's source, not the reverse. |

## Manager verification

Checked directly, not taken on the reviewer's word: `MainMenu.swift:77,80`; missing `@MainActor` at `PalettePlacement.swift:8` vs present at `MainMenu.swift:17`; `max(y, vf.minY)` at `PalettePlacement.swift:37`; autosave name `"SettingsWindow"` already present at `d1578d5:SettingsWindow.swift:39`; `activeScreen` vs `OpenRouter.primaryScreen` split.

## Settled interpretations

1. **The palette closes before Settings is shown.** Issue #9 lists this as its own criterion, but #8's "⌘, works while the palette is open" is false without it. Accepted by Lucas 2026-08-15. #9 still owns the gear button, the searchable Settings result, and the extension→host command.
2. **The menu bar is never drawn.** The app is `LSUIElement`. Making it visible needs `.regular` activation policy and a Dock icon, contradicting the menu-bar-agent product. The menu's real job is key-equivalent dispatch. Accepted design, not a finding.
3. **S1 / P3** — see the ledger row above.

## Raw reports

`raw/issue-8-round1-standards-TBAKi6uM.md`, `raw/issue-8-round1-spec-nvQGlrPO.md`
