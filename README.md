# lil chromium

Little Arc-style ephemeral browser for macOS that **isn't a browser**. Each "lil" is a popup window of your existing Chromium-family browser (Helium, Chrome, Brave, …), so your logins just work and a lil costs almost no extra memory.

## How it works

```
link click in any app ──▶ LilChromium.app (default browser, menu bar)
⌘⌥N palette ────────────▶        │ url + mouse position
                                  ▼ unix socket (~/.lilchromium/relay-<browser>.sock)
                          lilchromium-host (one per running browser)
                                  ▼ native messaging
                          extension ──▶ minimal lil at your cursor
                                        hover top edge → address bar unfolds
                                        "Open in Helium" ⌘O ──▶ real tab / tab group / other browser
```

- Links clicked **inside** your browser never touch this; the browser handles its own links.
- If no browser or relay is up, links open as normal tabs in your primary browser. **Nothing is ever dropped.**
- Lils are real browser tabs: video, audio, Slack, and dev tools all work.
- Lils parked for days **survive browser restarts**, and they reopen at the same size and position.

## Install (~3 minutes)

Requires: macOS 13+ (Liquid Glass UI on macOS 26+), Xcode Command Line Tools, and at least one Chromium-family browser.

```bash
git clone https://github.com/mygirleatsmayo/lil-chromium && cd lil-chromium
make install        # builds the app, installs to /Applications, and writes native host manifests
                    # for every installed browser (Chrome, Helium, Brave, Edge, Arc, Vivaldi…)
```

**Load the extension** (once per browser you want lils in):
1. `chrome://extensions` (or `helium://extensions`, etc.) → **Developer mode** → **Load unpacked** → the `extension/` folder.
2. ID must read `oofeehjoocddelicpmnpbafmbalaakge`.

**Activate:**
1. Launch `/Applications/LilChromium.app` → Settings opens on first run: pick your **primary browser**, palette position, link behavior.
2. Menu bar icon → **Set as Default Browser…** → confirm.

## Use

| Action | How |
|---|---|
| Open link from any app | Click it; a lil opens at your cursor |
| Summon palette | **⌘⌥N** for fuzzy history search (type-ahead completes domains), a URL, or a search with your chosen engine; ↵ opens a lil |
| Address bar in a lil | Move the cursor to the top edge and the bar unfolds; **⌘L** focuses it. Edit the URL, ↵ navigates. Typing offers history suggestions |
| Promote to your browser | **Open in {Browser}** button or **⌘O**; moves the live tab, no reload |
| Promote into a tab group / other browser | **▾** caret next to the button |
| Links inside a lil | Open in a **new lil** (default) · **⌘-click** flips that · right-click menu has both (configurable in Settings, and sign-in popups are always left alone) |
| Send a normal tab to a lil | Right-click the page → **Send to lil** |
| Incognito lil | **⌘-Enter** in the palette, or right-click a link → **Open in incognito lil**; needs the extension's "Allow in Incognito" toggle |
| Sleep a lil to free its memory | ▾ menu or right-click → **Sleep this lil**; you get a screenshot and the sleeping mascot, and a click wakes it. Auto-sleep is configurable in Settings |
| Keep or expire a lil | ▾ menu → **Keep**: forever, 6h, 12h, 24h, or until quit (default in Settings) |
| Reload or copy the URL | Buttons in the hover bar |
| Close a lil | **⌘W**; gone, no trace |
| Go back | Two-finger swipe, **⌘[**, or the ← in the hover bar |

The palette closes only on **Esc**, **⌘⌥N**, **X**, or opening a result, so you can hop to Raycast or your clipboard manager and find it still open.

## Settings

Menu bar → **Settings…**: primary browser (button label + promote target + palette history source), fallback browser, palette position (centered near top / top right), new-window link behavior, lil lifetime default, sleep (idle minutes, audio guard, form guard, overlay tint, and the never-sleep whitelist), search engine (Google, DuckDuckGo, Bing, Kagi, or a custom template), hover bar style (Glass or Solid) with an optional tint, and launch at login. Stored at `~/.lilchromium/config.json`.

## Troubleshooting

- **Links open as normal tabs instead of lils** → the relay is down. Confirm the extension is loaded in your primary browser, then check `~/.lilchromium/host-<browser>.log`. Reloading the extension relaunches the host.
- **Palette has no history** → same relay check; palette still handles URLs + search.
- **⌘⌥N does nothing** → another app owns the hotkey (Arc uses the same one).
- **No hover bar on a page** → error pages/PDFs block content scripts; use **⌘⇧O** to promote.
- **Helium specifics** → Helium reads only its own manifest dir (`~/Library/Application Support/net.imput.helium/NativeMessagingHosts`); `make install-host` writes it when Helium is installed.

## Known limits

- **Mission Control**: with "Group windows by application" enabled (System Settings → Desktop & Dock), macOS stacks lils behind the main browser window, and no app can override this per window. App Exposé (Ctrl+↓, or a three-finger swipe down) spreads your browser's windows individually.
- **Other extensions' popups**: no Chrome API lets one extension open another extension's toolbar popup, so lils offer no extensions menu. Keyboard shortcuts you assign at `chrome://extensions/shortcuts` still work inside lils.
- The lil's title bar color follows the OS theme, not the page (Chromium limitation: no extension API for it).
- Universal Links (Zoom, Slack deep links) may bypass any default browser, this one included. That's macOS behavior.
- Promoting to a *different* browser opens the URL fresh there (live tab state can't cross browsers).