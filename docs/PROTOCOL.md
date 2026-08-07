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
  "version": 1,
  "defaultBrowser": "helium",
  "fallbackBrowser": "chrome",
  "paletteAnchor": "top-center",
  "linkBehavior": "same-lil",
  "knownBrowsers": [
    {"slug": "helium", "name": "Helium", "bundleId": "net.imput.helium", "installed": true},
    {"slug": "chrome", "name": "Google Chrome", "bundleId": "com.google.Chrome", "installed": true}
  ]
}
```

- `defaultBrowser`: promote target + palette history source + link-open fallback target.
- `paletteAnchor`: `"top-center"` (centered horizontally, top edge at 20% of screen height) | `"top-right"` (24pt insets).
- `linkBehavior`: `"same-lil"` (links that would spawn a new tab navigate the current lil instead) | `"new-lil"` (they cascade into a new lil). Per-click override via modifier/context menu flips the behavior.
- `knownBrowsers`: app scans /Applications + NSWorkspace on launch and on settings-open, writes results. Hosts/extension treat it as read-only truth.
- Missing file → components use built-in defaults (`helium`/`chrome`/`top-center`/`same-lil`). First app launch with no config opens the Settings window (onboarding) and writes it.

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

- `{"type":"open","url":string,"left":int,"top":int}` — open a lil. Coordinates as v1 (Chrome screen coords, app pre-flips Y). Extension applies remembered size, clamps, registers.
- `{"type":"history-query","id":string,"text":string,"maxResults":int}` → reply `history-result` as v1.

### extension → host (host handles directly; never reaches the app)

- `{"type":"get-context","id":string}` → host replies on the port:
  `{"type":"context","id":string,"browser":slug,"browserName":string,"defaultBrowser":slug,"defaultBrowserName":string,"fallbackBrowser":slug,"linkBehavior":"same-lil"|"new-lil","knownBrowsers":[{"slug":...,"name":...,"installed":bool}]}`
  Host reads config.json fresh on every call and injects its own detected identity. Extension calls this on every port (re)connect and caches.
- `{"type":"open-external","browser":slug,"url":string}` — host launches the URL in that browser via `open -b <bundleId> <url>` (or NSWorkspace equivalent). Fire-and-forget; host logs failures.

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
- **Link behavior**: on `onCreatedNavigationTarget` from a lil:
  - effective behavior = config `linkBehavior`, flipped if the originating click carried ⌘ (content script sends `{action:"clickHint",url,ts,meta:true|false}` on anchor clicks; SW matches hints within 1.5s by URL).
  - `same-lil` → navigate the source lil's tab to the new URL and close the spawned tab.
  - `new-lil` → v1 cascade (+32/+32 popup, registered).
- **Context menus** (`contexts:["link"]`, created in `onInstalled`): "Open link in new lil" and "Open link in this lil" — onClicked no-ops unless `tab.windowId` is a registered lil.
- Registry/restore/size-memory/history-responder: unchanged from v1.

## App behavior contract (v2 changes)

- Palette: anchor per config (`top-center` default: centered horizontally, panel top at 20% of the primary display's visibleFrame height). Dismiss ONLY on: Esc, ⌘⌥N toggle, X button, or opening a result. NOT on app deactivation (user can visit Raycast/pasteboard and come back). Panel level stays `.floating`, `.nonactivatingPanel`, visible across Spaces.
- Palette sends `open` anchored near the panel; link clicks anchored at mouse (unchanged).
- Settings window (Liquid Glass mini window): primary browser picker (installed only), fallback browser, palette position, link behavior, launch-at-login. Opens automatically on first run (no config.json).
- Menu bar: "New Lil ⌘⌥N", "Settings…", "Set as Default Browser…", separator, "Quit".

## Installer contract

`scripts/install-host.sh` writes the manifest into every existing browser dir among:
`Google/Chrome`, `Google/Chrome Beta`, `Google/Chrome Canary`, `net.imput.helium`, `BraveSoftware/Brave-Browser`, `Microsoft Edge`, `Arc/User Data`, `Vivaldi`, `Chromium` (each under `~/Library/Application Support/`, + `/NativeMessagingHosts/com.lilchromium.relay.json`). Helium does NOT read Chrome's manifests — its own dir is required.

## Coordinates / filesystem layout

Unchanged from v1 (see git history for the v1 text). Sockets now `relay-<slug>.sock`; favicon cache `~/.lilchromium/favicons/`; logs `~/.lilchromium/host-<slug>.log`.
