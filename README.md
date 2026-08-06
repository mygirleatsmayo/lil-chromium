# lil-chromium

Little Arc–style ephemeral browser for macOS — **without shipping a browser**. The "little windows" are Chrome popup windows in your existing profile, so every login you have in Chrome just works, and the memory cost is near zero.

## How it works

```
link click in any app ──▶ LilChromium.app (default browser, menu bar)
⌘⌥N palette ────────────▶        │ url + mouse position
                                  ▼ unix socket (~/.lilchromium/relay.sock)
                          lilchromium-host (launched by Chrome)
                                  ▼ native messaging
                          Chrome extension ──▶ minimal popup window at your cursor
                                               "Open in Chrome ⌘O" ──▶ real tab / tab group
```

- Links clicked **inside Chrome** never touch this — Chrome handles its own links.
- If Chrome or the relay is down, links fall back to opening in Chrome normally. **No link is ever dropped.**
- Little windows are real Chrome tabs: video, audio, Slack, dev tools — everything works.
- Windows you park for days **survive Chrome restarts** — the extension reopens them at the same size/position.

## Install (one time, ~3 minutes)

Requires: macOS 13+, Xcode Command Line Tools (`xcode-select --install`), Google Chrome.

```bash
git clone https://github.com/mygirleatsmayo/lil-chromium && cd lil-chromium
make install        # builds the app, copies to /Applications, installs the native host manifest
```

**Step 3 — load the extension (manual, once):**
1. Chrome → `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select the `extension/` folder from this repo.
3. The ID must read `oofeehjoocddelicpmnpbafmbalaakge` (it's pinned; if it doesn't, something's wrong).

**Step 4 — activate:**
1. Launch `/Applications/LilChromium.app` (menu bar icon appears).
2. Menu bar icon → **Set as Default Browser…** → confirm the system dialog.
3. Optional: **Launch at Login**.

## Use

| Action | How |
|---|---|
| Open link from Mail/Slack/Raycast/anywhere | Just click it — little window opens at your cursor |
| Summon palette | **⌘⌥N** anywhere — fuzzy search Chrome history, or type a URL / search query, ↵ opens a little window |
| Promote to Chrome | Click **Open in Chrome** pill (top right of the little window), or **⌘O** |
| Promote into a tab group | Click the **▾** caret on the pill → pick a group |
| Close little window | **⌘W** or the traffic light — gone, no trace |
| Go back | Two-finger swipe or **⌘[** (native Chrome) |
| Links inside a little window | Open in another little window, cascaded — big Chrome stays clean |

## Troubleshooting

- **Links open as normal Chrome tabs instead of little windows** → the relay isn't up. Check: extension loaded and enabled? `~/.lilchromium/host.log` for errors. Reload the extension (`chrome://extensions`) to relaunch the host.
- **Palette shows no history** → same relay check. Palette still works for URLs + Google search without it.
- **⌘⌥N does nothing** → another app owns the hotkey (Arc's Little Arc uses the same one — quit Arc or change its binding).
- **No overlay pill on a page** → some pages (Chrome error pages, PDFs, web store) block content scripts. Use the fallback shortcut **⌘⇧O**.
- **App not listed in default-browser picker** → make sure it's in `/Applications` and launched once.

## Known limits

- A few apps with Universal Links (Zoom, Slack deep links) grab their own URLs before any browser sees them. OS behavior, unavoidable.
- macOS shows a confirmation dialog when changing default browser; if you click "keep", nothing changes and the app can't tell.
- One Chrome profile is targeted (your default). Multi-profile support isn't built.

## Repo layout

```
extension/   Chrome MV3 extension (load unpacked, no build step)
mac/         Swift package: LilChromiumApp (menu bar) + lilchromium-host (relay)
scripts/     bundle-app.sh, install-host.sh
docs/        PROTOCOL.md — the contract between all three components
```
