# Material Symbols Rounded — bundled functional icons

The hoverbar's functional controls draw from Google's **Material Symbols
Rounded** family. The six glyphs this product uses are vendored here verbatim so
the extension never reaches the network for an icon and never depends on a font
service, a CDN stylesheet, or a build step.

## Provenance

- Upstream: <https://github.com/google/material-design-icons>
- Commit: `e083cc60a0828fdd3b404cea0cb8a5b900e9c23e`
- Upstream path: `symbols/web/<name>/materialsymbolsrounded/<name>_24px.svg`
- Variant axes: **Rounded**, weight 400, grade 0, optical size 24, fill 0 — the
  family default, identical for every glyph. That shared variant *is* the
  normalization the hoverbar relies on: one 24-unit grid (`viewBox="0 -960 960
  960"`), one stroke weight, one optical size.

| File | Upstream symbol | Hoverbar control |
| --- | --- | --- |
| `arrow_back.svg` | `arrow_back` | Back |
| `refresh.svg` | `refresh` | Reload |
| `link.svg` | `link` | Copy URL (inside the address field) |
| `check.svg` | `check` | Copy success tick, menu checkmark |
| `expand_more.svg` | `expand_more` | More options (caret) |
| `search.svg` | `search` | Omnibox search suggestion row |

## How the files are used

`extension/overlay.js` embeds each file's single `d` path attribute in its
`ICON_PATHS` table and renders it as an inline `<svg class="ico">`. Inlining is
deliberate:

- The hoverbar lives in a **closed shadow root**, where Chromium ignores
  `@font-face` — an icon font would have to be registered on the host document,
  polluting every page a lil visits.
- Inline paths inherit `currentColor`, so light/dark schemes and hoverbar tints
  recolor the icons with no extra rules and no flash of fallback text.
- No `web_accessible_resources` entry, no extra content script, no fetch.

The files here are the asset of record: `overlay.js` must render exactly their
path data, and `extension/test/overlay.test.js` asserts that it does, so any
drift from upstream fails the suite.

## License

Apache License 2.0 — see `LICENSE` in this directory. Copyright Google LLC. The
SVG files are unmodified upstream artifacts.
