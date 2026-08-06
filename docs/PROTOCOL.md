# lil-chromium — Component Protocol (v1)

Three components. One contract. Any change here must update all three.

## Components

1. **LilChromium.app** — Swift menu-bar agent (`LSUIElement`). System default browser. Owns the ⌘⌥N palette. Socket **client**.
2. **lilchromium-host** — native messaging host binary, launched by Chrome when the extension connects. Socket **server** + relay + queue.
3. **extension/** — Chrome MV3 extension (unpacked). Owns all Chrome windows/tabs behavior.

Extension ID (pinned via `key` in manifest): `oofeehjoocddelicpmnpbafmbalaakge`
Native messaging host name: `com.lilchromium.relay`
Native host manifest path (user-level): `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.lilchromium.relay.json`
`allowed_origins`: `["chrome-extension://oofeehjoocddelicpmnpbafmbalaakge/"]`

## Transports

- **Extension ↔ host**: Chrome native messaging over stdio. 4-byte native-endian uint32 length prefix + UTF-8 JSON. Extension opens the port with `chrome.runtime.connectNative("com.lilchromium.relay")` on service-worker start (`onStartup`, `onInstalled`, and top-level SW execution), keeps it open forever, reconnects on `onDisconnect` (backoff 250ms → 5s max). The open port keeps the MV3 worker alive.
- **App ↔ host**: Unix domain socket at `$HOME/.lilchromium/relay.sock`. Newline-delimited JSON (one object per line, no pretty-printing). App connects per request (short-lived connections are fine). Host creates `~/.lilchromium/` if missing; on bind failure, if a live host answers a `ping` on the existing socket the new host exits 0, otherwise it unlinks the stale socket and rebinds. Host exits when its stdin (Chrome pipe) closes, and removes the socket file on exit.

## Messages

All JSON objects with a `type` field. `id` is a caller-generated string for request/response matching.

### app → extension (host relays socket → port)

- `{"type":"open","url":string,"left":int,"top":int}`
  Open an ephemeral window. `left`/`top` = suggested window top-left in **Chrome screen coordinates** (global desktop space, top-left origin, points/DIPs — the app performs the AppKit Y-flip before sending). Extension applies remembered size, clamps fully on-screen, creates `type:"popup"` window, registers it as ephemeral.
- `{"type":"history-query","id":string,"text":string,"maxResults":int}`
  Extension calls `chrome.history.search({text, maxResults, startTime: now − 90 days})` and replies.

### extension → app (host relays port → socket, matched by `id` to the requesting socket connection)

- `{"type":"history-result","id":string,"items":[{"url":string,"title":string,"lastVisitTime":number,"visitCount":int,"typedCount":int}]}`

### host-only (never forwarded)

- `{"type":"ping","id":string}` → `{"type":"pong","id":string,"extensionConnected":bool}`
  Host answers directly on the socket. App uses this to decide fallback.

### Queueing

If the extension port is down when an `open` arrives, host queues it (max 20, FIFO, drop oldest) and flushes on reconnect. `history-query` while disconnected: reply immediately with `{"type":"history-result","id":...,"items":[]}`.

## App behavior contract

- Registers `CFBundleURLTypes` for `http` + `https` (`LSHandlerRank: Default`) + `CFBundleDocumentTypes` for `public.html`. Does NOT declare `mailto`.
- On URL receive: capture `NSEvent.mouseLocation`, convert to Chrome coords (flip Y against primary screen height, offset so cursor sits ~40pt inside the window's top-left, clamp to that display's visible frame), send `open`. On socket failure OR `pong.extensionConnected == false`: fall back to opening the URL in Chrome directly (`NSWorkspace`, bundle id `com.google.Chrome`) — never drop a link.
- ⌘⌥N global hotkey (Carbon `RegisterEventHotKey`, no permissions) → palette panel, top-right of primary display. Palette: fuzzy search over history snapshot (`history-query` with `text:""`, `maxResults:3000` on open, cached; local fuzzy + frecency ranking), plus "Search Google" row and "Open URL" row when input looks like a URL. Enter → `open` with coords anchored at the palette's position. Esc / focus-loss closes.
- Menu bar: New Little Window (⌘⌥N), Set as Default Browser, Launch at Login (SMAppService), Quit.

## Extension behavior contract

- Ephemeral registry in `chrome.storage.local`: `{ [windowId]: {url, bounds} }`, updated on `tabs.onUpdated` (URL changes) and `windows.onBoundsChanged`. Removed on `windows.onRemoved`.
- `chrome.runtime.onStartup`: reopen every registry entry (Chrome restart/crash restore — windows parked for days must survive), then rebuild registry with new window ids.
- Remembered size: last user-resized ephemeral window size in `storage.local` (default 1100×800). `open` without explicit size uses it.
- Child links: `chrome.webNavigation.onCreatedNavigationTarget` — if source tab is in an ephemeral window, re-parent the new tab into a new ephemeral popup window cascaded +32/+32 from the source window.
- Overlay: content script on all http/https pages; on load asks SW "am I ephemeral?" (checks sender tab's windowId against registry); if yes, mounts a closed-shadow-DOM pill, top-right: **"Open in Chrome ⌘O"** + caret. Caret menu: "New tab in Chrome", existing tab groups (`tabGroups.query`), "New Chrome window". Content script intercepts ⌘O keydown (capture phase, preventDefault) as primary shortcut; `chrome.commands` `promote-tab` (suggested `MacCtrl+Shift+O` fallback binding) as backstop for pages where content scripts can't run.
- Promote (no reload, state preserved), try in order:
  1. `chrome.tabs.move(tabId, {windowId: lastFocusedNormalWindow, index: -1})` then `tabs.update(tabId,{active:true})` + focus that window;
  2. fallback `chrome.windows.create({tabId, focused:true})`;
  3. last resort `tabs.create` with URL + close popup.
  Into a tab group: `chrome.tabs.group({tabIds:[tabId], groupId})` (moves tab to the group's window). After promote, deregister the window (it auto-closes when its only tab leaves).

## Coordinates

AppKit: origin bottom-left of primary screen, Y up. Chrome: origin top-left of primary screen, Y down. Conversion in the app:
`chromeY = primaryScreen.frame.height − appKitY`. Multi-display: global space is shared; only the Y flip is needed. Chrome expects points (macOS DIPs) — no Retina scaling math.

## Filesystem layout

```
lil-chromium/
  extension/            # MV3, plain JS, no build step, load unpacked
  mac/                  # Swift Package: LilChromiumApp + lilchromium-host executables
  scripts/              # bundle + install scripts
  docs/PROTOCOL.md      # this file
  Makefile
  README.md
```
