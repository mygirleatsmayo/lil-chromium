# Issue #10 — search providers

Native search-provider selection is now explicit stored state, with Startpage as the missing-config default and a Custom draft that is not the committed template.

## What landed

1. **`searchEngine.provider`** (`google` / `ddg` / `bing` / `kagi` / `startpage` / `custom`) is the Settings selection. Decode is additive: a missing key uses the stored `name`, never the template. Encode writes the id. Unknown top-level fields still survive a rewrite.
2. **Fresh or missing `searchEngine`** (no file, or a v1 file with no section) defaults to Startpage (`https://www.startpage.com/sp/search?query=%s`). An existing named engine (e.g. Kagi in `config-v2-complete`) stays that engine.
3. **Settings** (inside the existing 440×520 shell) offers Google, DuckDuckGo, Bing, Kagi, Startpage, and Custom. Picker bindings go through `SearchEngineEditor`; they do not match the current template.
4. **Custom** stays Custom. The editable field stays visible. A partial/invalid draft stays in the editor, is explained with the existing caption, and does not change `provider` or the last committed template. Commit happens only when the draft contains `%s`.
5. **Palette** (and hoverbar, via the existing `context.searchEngine.template` path) still build search URLs with `SearchEngineConfig.searchURL(for:)`. Valid templates percent-encode the query.
6. **Paste** in the Custom field is the standard `TextField` + nil-targeted Edit menu already installed by `MainMenu.swift`. No custom paste path.

## Criteria

| # | How |
|---|-----|
| 1 | `SearchEngineConfig.defaults` + missing-section decode → Startpage; named existing files keep `name`/`template` and infer `provider` from `name`. |
| 2 | `SearchProviders.all` in that order, shown by `SettingsSearchControls`. |
| 3 | Stored `provider`; Settings never pattern-matches `template`. |
| 4 | `selectProvider("custom")` writes Custom and keeps the field up. |
| 5 | `customDraft` is view/editor state; invalid text does not rewrite config. |
| 6 | `SearchEngineEditor.updateCustomDraft` commits only on `%s`. |
| 7 | `searchURL(for:)` on the committed template; palette already consumes `model.searchEngine`. |
| 8 | Unchanged native Edit menu; Custom is a normal `TextField`. |
| 9 | `SearchProviderTests` plus the #3 suite’s default / verbatim / substitution cases. |

## Out of scope

- Settings shell size, placement, autosave (`LilChromiumSettings`).
- Tint editor, Lil Nap, browser catalog, MV3 harness.
- Shared fixture JSON (provider is inferred on decode so the files stay a v0.3 wire meaning).
- Launching the app or opening a window.
- Rewriting `docs/PROTOCOL.md` (see conflict below).
- Extension `DEFAULT_SEARCH` (still Google when context is missing).

## PROTOCOL.md conflict (not guessed)

Issue #10 criteria 1–2 contradict `docs/PROTOCOL.md`:

- The config example and “missing file/fields → built-in defaults” still document Google as `searchEngine`.
- Presets listed there are Google, DuckDuckGo, Bing, Kagi, Custom — no Startpage.
- Hover-bar copy still says non-URL input → Google search, while the later omnibox line already uses `searchEngine.template`.

Native defaults and Settings follow #10. PROTOCOL.md was not rewritten (human-facing contract prose; a three-component change). The hoverbar already substitutes the template from context, so a valid native selection still drives both surfaces.

## Verified

- `swift build` (from `mac/`) — pass
- `swift test` (from `mac/`) — 62 tests, 7 suites, pass
- `make app` — pass (`mac/build/LilChromium.app`)
