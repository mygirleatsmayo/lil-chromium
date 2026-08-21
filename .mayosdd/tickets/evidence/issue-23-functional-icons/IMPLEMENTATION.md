# Issue #23 — Normalize native and hoverbar functional icons

Implemented on `surfx/implement-github-issue-23-functional-ico-lYBn8edr`, branched
from the `release/v0.4` state. Blockers #9 and #19 are implemented and reviewed in
this branch; their GitHub state is administrative and was not treated as a gate.

## Decisions

### The hoverbar asset is inline SVG from the official family, not a font

The hoverbar mounts in a **closed shadow root**. Chromium ignores `@font-face`
declared inside a shadow root — an icon font would have to be registered on the
host document of every page a lil visits, which the overlay is explicitly built
never to do. Ligature-based icon fonts also render their literal ligature text
("arrow_back") until the face loads.

So the bundled asset is the official Material Symbols **Rounded** SVG set,
vendored verbatim, with each glyph's single `d` path inlined into `overlay.js`.
Inline paths inherit `currentColor`, so light/dark and hoverbar tint recolor every
icon with no extra rules. No `web_accessible_resources` entry, no second content
script, no fetch, no font, no build step.

### Native controls were already SF Symbols; the work was semantics, not swaps

Every native functional control already used a semantic SF Symbol. The gaps #23
names — accessibility labels, platform tinting, hit areas — were the real work.

## Changed surfaces

| File | Change |
| --- | --- |
| `extension/assets/material-symbols/*.svg` | **New.** Six official Rounded glyphs, unmodified. |
| `extension/assets/material-symbols/LICENSE` | **New.** Apache-2.0, verbatim from upstream. |
| `extension/assets/material-symbols/NOTICE.md` | **New.** Provenance, variant axes, per-file mapping, why the paths are inlined. |
| `extension/overlay.js` | Icon system (`ICON_PATHS` / `icon()` / `setIcon()`); `.ico` CSS contract; Copy URL moved inside the address field; glyph-only success feedback; omnibox + menu rows on the same system. |
| `extension/test/overlay-harness.js` | Clipboard stub (`page.clipboard`), pointer `page.click()` helper. |
| `extension/test/overlay.test.js` | Four focused tests (below). |
| `mac/Sources/LilChromiumApp/SettingsWindow.swift` | Warning triangles → `.symbolRenderingMode(.multicolor)` + missing accessibility label; whitelist remove button gains an accessible name and a Dynamic-Type-scaled hit area. |
| `mac/Sources/LilChromiumApp/PaletteController.swift` | Settings/Close share one symbol size and one 28pt square hit area (was 22pt); Close gains an explicit accessibility label. |

Untouched, by design: messages, `config.json`, relay/native-host behavior,
routing, browser identity, `docs/PROTOCOL.md`, `extension/manifest.json`, and every
brand asset (#24's territory).

## Asset provenance and licensing

- Upstream: <https://github.com/google/material-design-icons>
- Commit: `e083cc60a0828fdd3b404cea0cb8a5b900e9c23e`
- Path: `symbols/web/<name>/materialsymbolsrounded/<name>_24px.svg`
- Variant: **Rounded**, weight 400, grade 0, optical size 24, fill 0 — identical
  for all six, which is exactly what normalizes their optical size and weight.
- Glyphs: `arrow_back` (Back), `refresh` (Reload), `link` (Copy URL), `check`
  (copy success, menu checkmark), `expand_more` (More options), `search`
  (omnibox search row).
- License: Apache-2.0, vendored at `extension/assets/material-symbols/LICENSE`.
- Files are unmodified upstream artifacts. `overlay.js` embeds their `d` values
  verbatim, and a test compares the rendered path against the bundled file, so
  drift from the official asset fails the suite.

## The icon system

One element contract, applied everywhere:

```html
<svg class="ico" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="…"/></svg>
```

- **Optical size / weight** — one 24-unit grid and one family variant; the
  stylesheet never sizes an icon per button.
- **Size** — `--ico: 18px` on the bar; `.omni, .menu { --ico: 16px }` matches the
  16px favicons those rows already align to. Two context values, no exceptions.
- **Alignment** — `display: block` kills the inline baseline gap; `.btn.icon`
  flex-centers a 30×30 target.
- **Contrast / theming** — `fill: currentColor` inherits `--fg`, so light, dark,
  glass, solid, and tinted bars all recolor for free.
- **Hit areas** — every bar control, Copy URL included, is a 30×30 target.
- **Accessibility** — icons are `aria-hidden` and non-focusable; the control keeps
  its own `aria-label`/`title`.

## Copy URL

Moved from the bar into `.addrwrap`, absolutely positioned at the field's
trailing edge with a `link` glyph. Both field states reserve 34px of trailing
padding, and the collapsed `.url` pads symmetrically so it stays centred.

Success feedback swaps the glyph to `check` for `COPY_TICK_MS` and back —
`aria-label` and `title` stay `"Copy URL"` throughout, so the control never
renames itself under an assistive-technology user. The reset timer is cleared on
re-press so rapid copies cannot strand the tick.

Because the control now lives *inside* the field, its `mousedown` default is
suppressed: pressing Copy while editing no longer reads as a click-away, so #19's
focus, half-typed text, and Escape layering survive intact.

## Red → green evidence

Seams under test (fixed by the ticket brief): icon-system markup/semantics, Copy
URL placement and stable accessible meaning, success feedback, preserved keyboard
and pointer interaction. Four vertical slices, each red before green.

| # | Test | Red | Green |
| --- | --- | --- | --- |
| 1 | `hoverbar controls draw bundled Material Symbols, not text glyphs` | `AssertionError: expected an icon for arrow_back` (7 pass / 1 fail) | 8 pass |
| 2 | `Copy URL sits inside the address field and keeps one accessible name` | `AssertionError: expected an icon for check` (8 pass / 1 fail) | 9 pass |
| 3 | `copying from inside the field does not collapse an in-progress edit` | `down.defaultPrevented` false (9 pass / 1 fail) | 10 pass |
| 4 | `omnibox and menu rows use the same icon system as the bar` | `AssertionError: expected an icon for search` (10 pass / 1 fail) | 11 pass |

No test snapshots a glyph *name* or re-implements platform rendering: slice 1
compares against the bundled asset file (a provenance guard), and slices 2–4
assert user-visible behavior — what lands on the clipboard, what the control
announces, and where focus and typed text end up.

**No Swift tests were added.** The native changes are accessibility labels,
symbol rendering mode, and hit-area constants — platform appearance and
AppKit/SwiftUI wiring with no pure behavioral seam. A test over them would only
restate the source. They are covered by the visual-QA checklist below instead.

## Full verification

Run once, at the end, from a clean tree:

| Command | Result |
| --- | --- |
| `pnpm test` | **140 pass, 0 fail** (16 suites) |
| `swift test` (from `mac/`) | **163 pass, 0 fail** (16 suites) |
| `make app` (repo root) | **Build complete** → `mac/build/LilChromium.app` |
| `git diff --check` | clean |

Not run, per the ticket: `make install`, any app/browser/extension/native-host
install, launch, reload, or quit, and anything touching `/Applications` or a live
browser profile.

## Remaining visual QA (real Mac, real browser)

Automated DOM tests say nothing about optics. These need eyes:

**Hoverbar, in a real lil**
1. Back, Reload, Copy URL, and More options read as one family — equal optical
   weight, no glyph heavier or lighter than its neighbours.
2. Copy URL sits flush inside the address field's trailing edge, vertically
   centred, and its hover highlight does not collide with the field's radius.
3. The collapsed URL still reads centred with Copy URL present; a long
   host + path ellipsizes without sliding under the button.
4. Press Copy: the tick is legible and reverts cleanly; hover tooltip still says
   "Copy URL" during the tick.
5. Repeat 1–4 at **1×, 2× (Retina), and a scaled resolution** — hairline icon
   strokes are where non-integer scaling shows first.
6. Repeat 1–4 in **light and dark**, in **glass and solid** hoverbar style, and
   with a **saturated tint** — check the icons keep contrast against the bar.
7. Open the omnibox: the search glyph aligns with the favicons on the rows above
   and below it, same optical size.
8. Open the caret menu: the checkmark aligns to the trailing edge and does not
   look oversized next to the item's label.
9. ⌘L → type → press Copy: the field stays open, focused, and still holds the
   typed text (the pointer-behavior slice, confirmed on real Chromium).

**Native**
10. Settings → the two warning triangles render in the system warning yellow in
    both light and dark, and match each other.
11. Settings → a whitelist row's remove button is comfortably clickable and
    VoiceOver announces "Remove <domain> from the whitelist", not a symbol name.
12. Palette → Settings and Close look equally weighted at 28pt, stay centred in
    the 56pt input row, and the wider controls did not visibly shorten the field.
13. VoiceOver over the palette: Settings and Close both announce their names.
14. Repeat 10–13 at a **larger Dynamic Type** setting — the whitelist remove
    target should grow with the text beside it.
