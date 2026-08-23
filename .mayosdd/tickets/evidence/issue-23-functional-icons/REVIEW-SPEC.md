# Issue #23 — Spec review

- Fixed point: `411d47983443915c1fa67c77285471db309676d2`
- Review head: `bb3740de5f8d506da074c21e5f24a48f3c54095d` (`HEAD` matches)
- Commits: `bb3740d feat(icons): issue #23 — normalize native and hoverbar functional icons`

## Spec sources

- GitHub issue #23 (body; 0 comments). Parent #2 only where it constrains #23: stories 66–67, 83–84; decisions 40–41; testing decision 12 (icon optics on a real Mac).
- Evidence, not authority: `IMPLEMENTATION.md` in this directory.

## Result

**1 finding. Worst severity: Medium.**

## Findings

### 1. Medium — focused visual QA is unmet

**Spec:** “Focused visual QA covers native Settings/palette controls and hoverbar alignment at representative display scales.” Parent #2 testing decision 12 puts icon optics on a real-Mac pass.

**Impact:** Optical weight, 1×/2×/scaled alignment, tint contrast, and VoiceOver on Settings/palette are unverified. DOM tests cannot prove those ACs. `IMPLEMENTATION.md` still lists a 14-item live checklist as remaining.

**Code (what QA still has to judge):**
- `extension/overlay.js` — `.ico` / `--ico` (18px bar, 16px omnibox/menu), 30×30 `.btn.icon`, in-field `.addrwrap .copy`
- `mac/Sources/LilChromiumApp/SettingsWindow.swift` — warning `.symbolRenderingMode(.multicolor)` + labels; whitelist `@ScaledMetric` 22pt target
- `mac/Sources/LilChromiumApp/PaletteController.swift` — shared 15pt symbols, 28pt Settings/Close hit areas

## Not findings

- Hoverbar uses vendored Material Symbols Rounded `d` paths (not remote assets or text glyphs). Copy sits in `.addrwrap` with `link` / success `check`; `aria-label` and `title` stay “Copy URL”.
- No extra user-facing behavior beyond #23. Copy `mousedown` `preventDefault` is required so the in-field control does not collapse a #19 edit.
- Menu-bar `sparkle` and brand assets are #24 / parent #2 decision 42, not #23.

## Verification

- Both refs resolve; `HEAD` equals the review head.
- Full range diff plus surrounding overlay/Settings/palette code.
- Bundled SVG `d` values match `ICON_PATHS` for all six glyphs.
- `pnpm exec node --test extension/test/overlay.test.js` — 11 pass (icon contract, copy placement/name, in-field edit, omnibox/menu icons).
