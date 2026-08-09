# Changelog

## v0.2 — 2026-08-07

Glass palette, hover address bar, multi-browser lils.

### Palette (⌘⌥N)
- **Enter opens the selected result** (was: selected the input text). Arrow keys wrap; Esc closes.
- Input text vertically centered; X button to dismiss.
- **Liquid Glass** material on macOS 26+ (`NSGlassEffectView`), `NSVisualEffectView` fallback on older systems.
- **Favicons** on every row (async, disk-cached at `~/.lilchromium/favicons/`).
- **Inline type-ahead**: typing `git` completes to `git·hub.com·` with the completion selected — Enter opens it.
- Single-line rows: favicon · title · dimmed domain, accent selection.
- **Ranking overhaul**: origins beat deep pages (`gi` → github.com, not a commit URL); near-duplicate URLs collapse to one row; max 3 rows per site; scattered fuzzy matches score near zero; frecency (visits + typed visits × recency half-life) weights everything.
- **Position**: centered horizontally, top at 20% of screen (configurable: top-right available in Settings).
- **Dismissal**: only Esc, ⌘⌥N, X, or opening a result. Switching to Raycast / clipboard managers keeps the palette up.

### Lils
- **Hover-reveal top bar** replaces the always-visible pill (nothing covers page UI while reading): cursor to top edge → back button · **editable address field** · **Open in {your browser}** ⌘O · ▾ menu. **⌘L** reveals and focuses the address field.
- **Link behavior is configurable**: links in a lil open in the **same lil** (default) or a new lil; **⌘-click** does the opposite of your default; right-click menu offers both explicitly.
- Promote menu (▾): default browser · host-browser tab · **tab group** · any other installed browser · close.

### Multi-browser
- Works across Chromium-family browsers: **Chrome, Helium, Brave, Edge, Arc, Vivaldi, Chromium** (+ Chrome Beta/Canary). The relay host detects which browser launched it; one socket per browser (`~/.lilchromium/relay-<browser>.sock`).
- **Settings window** (Liquid Glass, opens on first launch): primary browser, fallback browser, palette position, link behavior, launch at login. Stored at `~/.lilchromium/config.json`.
- Promote button and fallbacks target your **configured primary browser** (e.g. "Open in Helium").
- Installer writes native-host manifests for every installed browser — including Helium's own dir (`net.imput.helium`), which does not read Chrome's manifests.

### Fixes
- `forEventID:` → `andEventID:` label in the Apple Event handler (v0.1 build fix).
- `@MainActor` annotations for the Swift 6.2 toolchain (Xcode 26 beta) — isolation violations are hard errors there.

### Known limits
- A lil's title bar color follows the OS theme, not the page — Chromium exposes no API for popup window frames.
- Promoting to a *different* browser opens the URL fresh there (live tab state can't cross browsers).
- Universal Links (Zoom, Slack deep links) may bypass any default browser (OS behavior).

---

## v0.1 — 2026-08-06

Initial release: the ephemeral-browser architecture, no new browser engine.

- **LilChromium.app** — tiny Swift menu-bar agent registered as the macOS default browser. Links from any non-browser app open as a **lil**: a minimal popup window of your real Chrome profile (logins shared for free), positioned at the mouse cursor.
- **⌘⌥N palette** — global hotkey, fuzzy search over Chrome history + Google search + direct URLs; Enter opens a lil.
- **Native-messaging relay** — unix socket ↔ Chrome extension; queues links while the extension is down; falls back to opening a normal tab so no link is ever dropped.
- **MV3 extension** — creates/positions lils, remembers window size, **restores parked lils after a browser restart**, cascades child links, and promotes: **Open in Chrome ⌘O** moves the live tab (no reload) into a normal window or a **tab group**.
- Tooling: `make install` (app bundle without Xcode, ad-hoc signing, native-host manifest installer), pinned extension ID, `docs/PROTOCOL.md` contract.
