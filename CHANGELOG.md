# Changelog

## v0.3 - 2026-08-11

*Sign-in popups work. Lils sleep, die, and search.*

### Fixes
- **Google sign-in works in a lil.** The extension leaves OAuth popups native. It does not re-parent, navigate, or register a window that reports `type === "popup"`, carries no `openerTabId`, or matches the OAuth guard list. `window.opener` and `postMessage` stay intact, so the sign-in flow finishes.
- **A `target=_blank` link keeps the focus in the lil.** The extension waits for the new tab to settle, then either re-parents it into a new lil or navigates the source lil. It focuses that lil window explicitly. The focus no longer leaks to the main browser window.
- **MRU focus stack.** The extension tracks lil focus order through `windows.onFocusChanged`. When you close a focused lil, the top of the stack takes the focus. Geometry updates no longer carry a `focused` flag.
- **The palette keeps a fixed width (620 pt).** A long title truncates at the tail. A URL truncates at the head. The panel does not widen.

### Lifetimes
- **Set how long a lil lives**: forever, 6 h, 12 h, 24 h, or until you quit the browser. Settings holds the default. The ▾ menu overrides it for one lil.
- A one-minute alarm sweep closes an hour-based lil when it stays idle past its limit. The content script reports your interactions to reset the idle clock.
- Restore-on-startup skips a lil with the until-quit lifetime.

### Sleep
- **Put a lil to sleep to release its memory.** Use the ▾ menu or the page context menu. The extension captures the page, then shows a sleep page: your screenshot, a tint, and the sleeping-lil mascot. Click anywhere to wake the lil. It loads the original URL fresh.
- **Auto-sleep** puts an idle lil to sleep after the number of minutes you set in Settings.
- Three guards skip auto-sleep only: the audio guard (the tab plays sound), the form guard (the page holds a dirty form), and the never-sleep whitelist.
- Edit the whitelist from the page context menu ("Never sleep {domain}"). The host merges the change into `config.json`.
- Restore reopens a sleeping lil as a sleep page, not a live load.
- The mascot ships as a data-URI text asset (`extension/assets/sleeping-lil-data.js`), because this repo cannot take a binary push.

### Hover bar
- **Omnibox.** Type in the address field to get a suggestions dropdown: fuzzy history matches from `chrome.history.search` ranked origin-first, a direct-URL row, and a search row. Arrow keys move the selection. Enter opens it. Esc closes the dropdown first and the bar second.
- **Reload** and **copy URL** buttons. Copy shows a short "Copied" tick.
- **Style**: Glass (the v0.2 look) or Solid (opaque, matched to the light or dark title bar). An optional tint recolors either one.

### Incognito lils
- Open one with **⌘-Enter** in the palette, with "Reopen in incognito lil" in the ▾ menu, or with "Open link in incognito lil" in the link context menu.
- The extension needs its Allow-in-Incognito toggle. Without it you get a normal lil and a notification that points at the toggle.
- An incognito lil never enters the restore registry, never sleeps, and never gets captured.

### Send to lil
- Right-click a page in a normal window and select **Send to lil**. The extension moves the live tab into a lil. The tab does not reload.

### Settings
- New controls: lifetime default, the sleep section (enable, idle minutes, audio guard, form guard, tint, whitelist editor), search engine (Google, DuckDuckGo, Bing, Kagi, or a custom template), and hover bar style plus tint.
- The same-lil link behavior now carries a warning: it can break sign-in popups.
- The window reads `config.json` fresh on open, because the host also writes the whitelist.

### Protocol (v3)
- `hello` context carries the config objects verbatim from `config.json`, plus the host's browser identity.
- New message `whitelist-op` (`add`/`remove`): the host merges the domain into `sleep.whitelist`.
- `open` accepts `incognito`.
- `ConfigMerge.swift` holds one read-merge-write path for `config.json`, shared by the app and the host. A writer replaces the top-level keys it owns and preserves every unknown key.

### Known limits
- **Mission Control**: with "Group windows by application" on (System Settings → Desktop & Dock), macOS stacks lils behind the main browser window. No app can override this per window. Use App Exposé (Ctrl+↓) to spread the windows.
- **Other extensions' popups**: no Chrome API opens another extension's toolbar popup, so a lil offers no extensions menu. A keyboard shortcut from `chrome://extensions/shortcuts` still works in a lil.

---

## v0.2 - 2026-08-07

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

## v0.1 - 2026-08-06

Initial release: the ephemeral-browser architecture, no new browser engine.

- **LilChromium.app** — tiny Swift menu-bar agent registered as the macOS default browser. Links from any non-browser app open as a **lil**: a minimal popup window of your real Chrome profile (logins shared for free), positioned at the mouse cursor.
- **⌘⌥N palette** — global hotkey, fuzzy search over Chrome history + Google search + direct URLs; Enter opens a lil.
- **Native-messaging relay** — unix socket ↔ Chrome extension; queues links while the extension is down; falls back to opening a normal tab so no link is ever dropped.
- **MV3 extension** — creates/positions lils, remembers window size, **restores parked lils after a browser restart**, cascades child links, and promotes: **Open in Chrome ⌘O** moves the live tab (no reload) into a normal window or a **tab group**.
- Tooling: `make install` (app bundle without Xcode, ad-hoc signing, native-host manifest installer), pinned extension ID, `docs/PROTOCOL.md` contract.
