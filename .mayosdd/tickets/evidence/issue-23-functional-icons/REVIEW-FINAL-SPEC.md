# Issue #23 — final Spec review

Pinned refs (all resolve; `HEAD` = final review head):

- Original: `411d47983443915c1fa67c77285471db309676d2`
- Final: `97afc83170d2cd24d1facff39330fe7c3ad70ada`
- Commits: `bb3740d` feat(icons); `78ff486` freeze ledger; `0b6e620` S2 clock; `97afc83` remediation review docs

## Spec sources

- GitHub issue #23 (title, ACs, blockers #9/#19; 0 comments).
- Parent #2 only where it constrains #23: stories 66–67, 83–84; decisions 40–41. Testing decision 12 is ledger **P1** (deferred to #26), not reopened.
- Frozen ledger from this task. Evidence in this directory is not authority.

## Ledger status

- **S1** won't-fix — untouched.
- **S2** fix — opt-in harness clock; test advances 1199ms (`check`) then 1ms (`link`). Production `COPY_TICK_MS` remains unexported (`overlay.js` `const COPY_TICK_MS = 1200`).
- **P1** deferred to #26 — not reopened.

## Findings

No findings.

## S2 / ticket behavior

Remediation did not change overlay, native UI, assets, or protocol. Copy still sits in `.addrwrap`, uses `link`/`check`, keeps `aria-label`/`title` `"Copy URL"`, and resets on the 1200ms deadline. `mousedown` `preventDefault` still protects #19 in-field edit.

## Coverage (not findings)

- Hoverbar: bundled Material Symbols Rounded `d` paths, inline `.ico` / `--ico` (18px bar, 16px omni/menu), 30×30 `.btn.icon`; no remote assets; Back/Reload/Copy/caret/search/check are SVGs, not text glyphs.
- Native: SF Symbols (`gearshape`, `xmark.circle.fill`, warning triangles, `minus.circle.fill`); shared 15pt/28pt palette targets; Settings names + `@ScaledMetric` whitelist hit area.
- Menu-bar `sparkle` is brand (#24 / parent decision 42), not a #23 functional control.

## Verification

- Range `git diff` / `git log` as specified; `HEAD` matches final head.
- Live #23 via `gh issue view 23`; parent excerpts for the rows above.
- Surrounding `overlay.js`, `SettingsWindow.swift`, `PaletteController.swift`, overlay tests/harness.
