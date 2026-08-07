# lil-chromium

Little Arc-style ephemeral browser for macOS that **ships no browser of its own**. Each "lil" is a popup window of your existing Chromium-family browser (Helium, Chrome, Brave, …), so your logins just work and a lil costs almost no extra memory.

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
- Lils parked for days **survive browser restarts**, reopening at the same size and position.

## Install (~3 minutes)

Requires: macOS 13+ (Liquid Glass UI on macOS 26+), Xcode Command Line Tools, at least one Chromium-family browser.

```bash
git clone https://github.com/mygirleatsmayo/lil-chromium && cd lil-chromium
make install        # builds the app, installs to /Applications, writes native host manifests
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
| Summon palette | **⌘⌥N** for fuzzy history search (type-ahead completes domains), a URL, or a Google search; ↵ opens a lil |
| Address bar in a lil | Move the cursor to the top edge and the bar unfolds; **⌘L** focuses it. Edit the URL, ↵ navigates |
| Promote to your browser | **Open in {Browser}** button or **⌘O**; moves the live tab, no reload |
| Promote into a tab group / other browser | **▾** caret next to the button |
| Links inside a lil | Open in the **same lil** (default) · **⌘-click** for a new lil · right-click menu has both (configurable in Settings) |
| Close a lil | **⌘W**; gone, no trace |
| Go back | Two-finger swipe, **⌘[**, or the ← in the hover bar |

The palette closes only on **Esc**, **⌘⌥N**, **X**, or opening a result, so you can hop to Raycast or your clipboard manager and come back to it still open.

## Settings

Menu bar → **Settings…**: primary browser (button label + promote target + palette history source), fallback browser, palette position (centered near top / top right), link behavior in lils, launch at login. Stored at `~/.lilchromium/config.json`.

## Troubleshooting

- **Links open as normal tabs instead of lils** → the relay is down. Confirm the extension is loaded in your primary browser, then check `~/.lilchromium/host-<browser>.log`. Reloading the extension relaunches the host.
- **Palette has no history** → same relay check; palette still handles URLs + search.
- **⌘⌥N does nothing** → another app owns the hotkey (Arc uses the same one).
- **No hover bar on a page** → error pages/PDFs block content scripts; use **⌘⇧O** to promote.
- **Helium specifics** → Helium reads only its own manifest dir (`~/Library/Application Support/net.imput.helium/NativeMessagingHosts`); `make install-host` writes it when Helium is installed.

## Known limits

- The lil's title bar color follows the OS theme, not the page (Chromium limitation: no extension API for it).
- Universal Links (Zoom, Slack deep links) may bypass any default browser, this one included. That is macOS behavior.
- Promoting to a *different* browser opens the URL fresh there (live tab state can't cross browsers).

## Testing a branch side-by-side

```bash
git worktree add ../lil-chromium-v0.2 v0.2 && cd ../lil-chromium-v0.2
make install    # swaps the installed app + manifests in place
# roll back: cd ../lil-chromium && make install
```
Same app/extension IDs, so builds swap in place rather than run at the same time.

## Repo layout

```
extension/   MV3 extension (load unpacked, no build step) — works in any Chromium-family browser
mac/         Swift package: LilChromiumApp (menu bar, palette, settings) + lilchromium-host (relay)
scripts/     bundle-app.sh, install-host.sh
docs/        PROTOCOL.md — the contract between all three components
```
