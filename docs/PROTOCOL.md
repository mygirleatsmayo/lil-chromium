# lil-chromium — Component Protocol (v2)

Three components. One contract. Any change here must update all three.
Terminology: an ephemeral window is a **lil** (plural: **lils**).

## Components

1. **LilChromium.app** — Swift menu-bar agent (`LSUIElement`). System default browser. Owns the ⌘⌥N palette + Settings window. Socket **client**.
2. **lilchromium-host** — native messaging host binary, launched by each Chromium-family browser running the extension. Socket **server** (one per browser) + relay + queue.
3. **extension/** — Chrome MV3 extension (unpacked), installable in any Chromium-family browser. Owns all window/tab behavior inside its browser.

Extension ID (pinned via `key` in manifest): `oofeehjoocddelicpmnpbafmbalaakge`
Native messaging host name: `com.lilchromium.relay`
`allowed_origins`: `["chrome-extension://oofeehjoocddelicpmnpbafmbalaakge/"]`

## Browser slugs

`chrome`, `helium`, `brave`, `edge`, `arc`, `vivaldi`, `chromium`, `unknown`.
The host detects its own browser at startup: `proc_pidpath(getppid())` → substring match on the executable path (helpers' paths contain the browser `.app` path). Bundle ids: chrome `com.google.Chrome`, helium `net.imput.helium`, brave `com.brave.Browser`, edge `com.microsoft.edgemac`, arc `company.thebrowser.Browser`, vivaldi `com.vivaldi.Vivaldi`, chromium `org.chromium.Chromium`.

## Config file — `~/.lilchromium/config.json`

Written by the app (Settings window / menu). Read by the app and by each host (fresh read per `get-context`). Schema (all fields present; unknown fields preserved on rewrite):

```json
{
  "version": 2,
  "defaultBrowser": "helium",
  "fallbackBrowser": "chrome",
  "paletteAnchor": "top-center",
  "linkBehavior": "new-lil",
  "ephemeralDefault": "never",
  "sleep": {
    "enabled": false,
    "afterMinutes": 30,
    "audioGuard": true,
    "formGuard": true,
    "tint": "purple",
    "whitelist": []
  },
  "searchEngine": {
    "name": "Google",
    "template": "https://www.google.com/search?q=%s"
  },
  "hoverBar": {
    "style": "glass",
    "tint": null
  },
  "knownBrowsers": [
    {"slug": "helium", "name": "Helium", "bundleId": "net.imput.helium", "installed": true},
    {"slug": "chrome", "name": "Google Chrome", "bundleId": "com.google.Chrome", "installed": true}
  ]
}
```

- `defaultBrowser`: promote target + palette history source + link-open fallback target.
- `paletteAnchor`: `"top-center"` (centered horizontally, top edge at 20% of screen height) | `"top-right"` (24pt insets).
- `linkBehavior` (v3 semantics): governs links that request a new tab/window (`target=_blank` etc.) from a lil. `"new-lil"` (DEFAULT: cascade into a new lil) | `"same-lil"` (collapse into the current lil — settings copy must warn this can break some sign-in popups). Native popup windows (featureful `window.open`, OAuth) are ALWAYS left alone regardless of this setting. ⌘-click flips the behavior per click.
- `ephemeralDefault`: `"never" | "6h" | "12h" | "24h" | "quit"` — default lifetime for new lils. `"quit"` = excluded from restore-on-startup. Hours = auto-close that long after the lil's last user interaction. Per-lil override lives in the extension registry, set from the hover bar menu.
- `sleep`: resource saver. `enabled` + `afterMinutes` (idle before auto-sleep), `audioGuard` (skip lils playing audio — toggle, default ON), `formGuard` (skip lils with unsubmitted form input — toggle, default ON), `tint` (`"gray" | "purple"` or `#rrggbb` overlay color), `whitelist` (domains never auto-slept).
- `searchEngine`: `template` with `%s` placeholder. Used by BOTH the palette and the lil hover-bar omnibox. Presets in Settings: Google, DuckDuckGo, Bing, Kagi, Custom.
- `hoverBar`: `style` `"glass"` (v0.2 look) | `"solid"` (adaptive title-bar-like background; glass kept only on the address input). `tint` optional `#rrggbb`, applies to either style.
- `knownBrowsers`: app scans /Applications + NSWorkspace on launch and on settings-open, writes results. Hosts/extension treat it as read-only truth.
- Missing file/fields → built-in defaults above. First app launch with no config opens the Settings window (onboarding) and writes it. All writers (app AND host) preserve unknown fields via read-merge-write.

## Transports

- **Extension ↔ host**: Chrome native messaging (unchanged from v1): 4-byte native-endian length + UTF-8 JSON; extension keeps a forever-open `connectNative` port with reconnect backoff.
- **App ↔ host**: Unix domain socket **per browser**: `~/.lilchromium/relay-<slug>.sock` (e.g. `relay-helium.sock`). Newline-delimited JSON. Host binds its own browser's socket; stale-socket rule as v1 (ping-probe live check → exit or unlink+rebind). Host removes its socket on exit (stdin EOF).

### App routing order (link click / palette open)

1. `relay-<defaultBrowser>.sock`
2. `relay-<fallbackBrowser>.sock`
3. any other `relay-*.sock` present (newest mtime first)
4. `NSWorkspace.open` the URL with the default browser's bundle id (launches it; normal tab)
5. same with fallback browser / any installed known browser.
Never `NSWorkspace.shared.open(url)` bare — the app IS the system default handler (infinite loop).

Palette `history-query` uses the same order but only steps 1–3 (no launch), returning empty items if no socket answers.

## Messages

All JSON with `type`. `id` for request/response matching.

### app → extension (via socket → port)

- `{"type":"open","url":string,"left":int,"top":int,"incognito":bool?}` — open a lil. Coordinates as v1 (Chrome screen coords, app pre-flips Y). Extension applies remembered size, clamps, registers. `incognito:true` (palette ⌘-Enter) → incognito lil: requires the extension's Allow-in-Incognito toggle; if `chrome.extension.isAllowedIncognitoAccess()` is false, open a normal lil to a page/notification explaining the toggle instead of dropping the URL.
- `{"type":"history-query","id":string,"text":string,"maxResults":int}` → reply `history-result` as v1.

### extension → host (host handles directly; never reaches the app)

- `{"type":"get-context","id":string}` → host replies on the port:
  `{"type":"context","id":string,"browser":slug,"browserName":string,"defaultBrowser":slug,"defaultBrowserName":string,"fallbackBrowser":slug,"linkBehavior":"new-lil"|"same-lil","ephemeralDefault":string,"sleep":{...},"searchEngine":{...},"hoverBar":{...},"knownBrowsers":[{"slug":...,"name":...,"installed":bool}]}`
  (v3: context carries the full config objects verbatim from config.json plus the host's browser identity.)
  Host reads config.json fresh on every call and injects its own detected identity. Extension calls this on every port (re)connect and caches.
- `{"type":"open-external","browser":slug,"url":string}` — host launches the URL in that browser via `open -b <bundleId> <url>` (or NSWorkspace equivalent). Fire-and-forget; host logs failures.
- `{"type":"whitelist-op","op":"add"|"remove","domain":string}` — host merges the change into `config.json` → `sleep.whitelist` (atomic read-modify-write, preserves all other fields, dedupes). Lets the extension's context menus edit the whitelist. App's Settings window reads the file fresh on open.

### host-only (socket side, never forwarded)

- `{"type":"ping","id"}` → `{"type":"pong","id","extensionConnected":bool,"browser":slug}` (browser field new in v2).

### Queueing

As v1: host queues `open` (max 20 FIFO) while the port is down; `history-query` gets an immediate empty `history-result`.

## Extension behavior contract (v2 changes)

- **Naming**: user-facing copy says "lil"/"lils" (e.g. "Open in a new lil").
- **Hover-reveal top bar** replaces the always-visible pill. Hidden by default (nothing covers page UI). Reveal when cursor is within 24px of the viewport top (~80ms intent delay) or on ⌘L; hide 300ms after the cursor leaves unless the address field is focused or a menu is open; Esc hides. Bar (closed shadow DOM, slides down, glass-look CSS backdrop-blur, adapts to `prefers-color-scheme`): [back button] [editable address field, centered — shows current URL compactly, full URL + select-all on focus, Enter navigates via SW `tabs.update` (add https:// when missing; non-URL input → Google search)] [**Open in {defaultBrowserName}** ⌘O] [⌄ caret menu].
- **Caret menu**: promote to default browser; "Open in {host browser} tab" when host ≠ default; tab groups of the host browser (`tabGroups.query`); other installed browsers ("Open in {name}…" → `open-external`); "Close lil".
- **Promote semantics**: if `defaultBrowser == ` the browser the lil lives in → v1 no-reload move (`tabs.move` → `windows.create({tabId})` fallback) + optional group. Else → `open-external` to the default browser + close the lil (state not preservable across browsers — accepted).
- **⌘O** (content-script capture + `promote-tab` command backstop) = promote to default browser. **⌘L** = reveal + focus address bar.
- **New-window link handling (v3 — replaces v2 collapse logic)**: on `onCreatedNavigationTarget` from a lil, WAIT for the tab to settle (retry `tabs.get`/`windows.get`), then branch:
  1. New tab's window `type === "popup"` OR `openerTabId` missing OR URL matches the OAuth guard list → **native popup, do not touch** (no re-parent, no navigate, no registry). This preserves `window.opener`/postMessage — the Google-auth fix.
  2. Landed as a tab in a normal window → effective behavior = config `linkBehavior` flipped by ⌘ clickHint: `new-lil` → re-parent into a new cascaded lil (create → `update({focused:true})`); `same-lil` → navigate the source lil's tab, close the spawned tab, then **explicitly re-focus the source lil's window** (focus must never remain on the main window).
- **Focus discipline (v3)**: maintain an MRU stack of lil windows via `windows.onFocusChanged`. Every lil create = `windows.create` then immediate `windows.update(id,{focused:true})`. Geometry updates never include `focused`. When a focused lil closes, explicitly focus the MRU top (lil or last-focused normal window).
- **Ephemerality (v3)**: registry entries carry `{expiry: "never"|"quit"|hoursNumber, lastInteraction: ts}` seeded from config `ephemeralDefault`; hover-bar caret menu sets per-lil override. A 1-minute `chrome.alarms` sweep (persistAcrossSessions) closes hour-based lils idle past their limit; `"quit"` lils are skipped by restore-on-startup. Content script reports interaction (debounced) to refresh `lastInteraction`.
- **Sleep (v3)**: manual (caret menu / page context menu "Sleep this lil") + auto (config `sleep.enabled`, idle > `afterMinutes`, same sweep alarm). Guards, each skipping auto-sleep only: `audioGuard` (`tab.audible`), `formGuard` (content script dirty-form tracking per research-v0.3.md), whitelist domains, focused lils, incognito lils. Sleep = `captureVisibleTab(windowId,{format:"jpeg",quality:60})` (throttled ≤2/sec, sequential) → store Blob in IndexedDB (`unlimitedStorage`) → navigate tab to `sleep.html?id=...` which shows the screenshot under a tinted overlay (config `sleep.tint`) + sleeping-lil mascot (`assets/sleeping-lil.png`) + "sleeping — click to wake" hint. Wake = click anywhere on sleep page → navigate back to original URL (fresh load), delete stored capture. Registry marks slept lils so restore reopens them as sleep pages, not live loads.
- **Hover bar additions (v3)**: reload button + copy-URL button (copy shows a brief "Copied" tick). **Omnibox**: address field input shows a suggestions dropdown — fuzzy history matches via `chrome.history.search` ranked origin-first (port the v0.2 palette ranking: host-prefix > title word-boundary > contains > dense fuzzy, × frecency, dedupe by host+path, ≤3 per host), plus a "Search {engine} for …" row (config `searchEngine.template`); arrow keys + Enter; Esc closes dropdown first, bar second. **Style**: config `hoverBar.style` — `glass` (v0.2 look) or `solid` (opaque adaptive background matching light/dark title-bar tones, glass only on the address input); optional `hoverBar.tint` recolors either.
- **Incognito lils (v3)**: `open.incognito` from the palette, caret-menu "Reopen in incognito lil", context-menu "Open link in incognito lil". Gate on `isAllowedIncognitoAccess()`; if off, fall back to a normal lil + notification pointing at the extension's Allow-in-Incognito toggle. Incognito lils: never in restore registry, never slept, never captured.
- **Context menus** (`contexts:["link"]`, created in `onInstalled`): "Open link in new lil", "Open link in this lil", "Open link in incognito lil" (lil windows only — onClicked no-ops otherwise); page context in lils: "Sleep this lil", "Never sleep {domain}" / "Allow sleeping {domain}" (→ `whitelist-op`); page context in NORMAL windows: **"Send to lil"** (re-parent the current tab into a lil via `windows.create({tabId})`, register it).
- Registry/restore/size-memory/history-responder: unchanged from v1, except restore skips `"quit"`-expiry lils and reopens slept lils as sleep pages.

## App behavior contract (v2 changes)

- Palette: anchor per config (`top-center` default: centered horizontally, panel top at 20% of the primary display's visibleFrame height). Dismiss ONLY on: Esc, ⌘⌥N toggle, X button, opening a result, or showing Settings (v4 — a floating panel must not cover the normal-level Settings window). NOT on app deactivation (user can visit Raycast/pasteboard and come back). Panel level stays `.floating`, `.nonactivatingPanel`, visible across Spaces.
- Palette sends `open` anchored near the panel; link clicks anchored at mouse (unchanged).
- Settings window (Liquid Glass mini window), organized into three sections (v4):
  - **General** — Primary browser picker (installed only), Fallback browser, palette position, search engine (presets + custom template), launch-at-login.
  - **Lils** — link behavior (with the "may break sign-in popups" warning on same-lil), ephemerality default, sleep (enable, minutes, audio guard toggle, form guard toggle, tint, whitelist editor).
  - **Hoverbar** — style (Glass / Solid) + optional tint.

  Singleton: one controller and one window for the life of the process; every entry point reaches it. Opens automatically on first run (no config.json). Reads config fresh and re-scans installed browsers on every open (the host may have edited the whitelist). Showing it activates Lil Chromium only — it never opens or focuses a browser window. **Placement (v4)**: first presentation matches the centered palette geometry (horizontally centered, top edge at 20% of the visibleFrame height) on the display under the pointer; once the user moves it, AppKit frame autosaving under `SettingsWindow` takes over.
- Palette: fixed width (620) — long titles truncate at the tail, URLs truncate at the head; the panel NEVER widens. Search row uses config `searchEngine`. **⌘-Enter** opens the selection as an incognito lil (`open.incognito:true`).
- Status item menu: "New Lil ⌘⌥N", "Settings…", "Set as Default Browser…", separator, "Quit".
- Application menu bar (v4): the app is `LSUIElement`, so macOS never draws this menu — it exists because `NSApplication.sendEvent(_:)` routes ⌘-key events through `NSApp.mainMenu` before the key window's responder chain, which is the only way ⌘, and native text editing work. **App** — About, separator, "Settings… ⌘,", "Set as Default Browser…", separator, "Quit ⌘Q". **Edit** — Undo/Redo, Cut/Copy/Paste/Paste and Match Style/Delete/Select All, all nil-targeted so they resolve against the current field editor (Settings fields and the palette input alike). **Window** — Minimize ⌘M, Zoom, Close ⌘W (`NSApp.windowsMenu` is deliberately unset).

## Installer contract

`scripts/install-host.sh` writes the manifest into every existing browser dir among:
`Google/Chrome`, `Google/Chrome Beta`, `Google/Chrome Canary`, `net.imput.helium`, `BraveSoftware/Brave-Browser`, `Microsoft Edge`, `Arc/User Data`, `Vivaldi`, `Chromium` (each under `~/Library/Application Support/`, + `/NativeMessagingHosts/com.lilchromium.relay.json`). Helium does NOT read Chrome's manifests — its own dir is required.

## Coordinates / filesystem layout

Unchanged from v1 (see git history for the v1 text). Sockets now `relay-<slug>.sock`; favicon cache `~/.lilchromium/favicons/`; logs `~/.lilchromium/host-<slug>.log`.
