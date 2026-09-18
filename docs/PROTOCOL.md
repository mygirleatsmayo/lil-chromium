# lil-chromium — Component Protocol (v2)

Three components. One contract. Any change here must update all three.
Terminology: an ephemeral window is a **lil** (plural: **lils**).

## Components

1. **LilChromium.app** — Swift menu-bar agent (`LSUIElement`). System default browser. Owns the ⌘⌥N palette + Settings window. Socket **client**.
2. **lilchromium-host** — native messaging host binary, launched by each Chromium-family browser running the extension. Socket **server** (one per browser) + relay + queue.
3. **extension/** — Chrome MV3 extension (unpacked), installable in any Chromium-family browser. Owns all window/tab behavior inside its browser.

Extension ID (pinned via `key` in manifest): `oofeehjoocddelicpmnpbafmbalaakge`
Native messaging host name: `com.lilchromium.relay`
App bundle id: `com.lilchromium.app`
`allowed_origins`: `["chrome-extension://oofeehjoocddelicpmnpbafmbalaakge/"]`

## Browser slugs

Each independently installed Chromium app or release channel is its own routing target (`relay-<slug>.sock`). Sibling channels of one browser product stay separate (Chrome Beta is not Chrome). Browser profiles are not slugs and are not routing targets.

`unknown` is the host-detection fallback when the parent process matches nothing; it is not a catalog entry and has no bundle id.

| slug | display name | bundle id | native-host dir |
|------|--------------|-----------|-----------------|
| `chrome` | Google Chrome | `com.google.Chrome` | `Google/Chrome` |
| `chrome-beta` | Google Chrome Beta | `com.google.Chrome.beta` | `Google/Chrome Beta` |
| `chrome-dev` | Google Chrome Dev | `com.google.Chrome.dev` | `Google/Chrome Dev` |
| `chrome-canary` | Google Chrome Canary | `com.google.Chrome.canary` | `Google/Chrome Canary` |
| `brave` | Brave | `com.brave.Browser` | `BraveSoftware/Brave-Browser` |
| `brave-beta` | Brave Beta | `com.brave.Browser.beta` | `BraveSoftware/Brave-Browser-Beta` |
| `brave-dev` | Brave Dev | `com.brave.Browser.dev` | `BraveSoftware/Brave-Browser-Dev` |
| `brave-nightly` | Brave Nightly | `com.brave.Browser.nightly` | `BraveSoftware/Brave-Browser-Nightly` |
| `edge` | Microsoft Edge | `com.microsoft.edgemac` | `Microsoft Edge` |
| `edge-beta` | Microsoft Edge Beta | `com.microsoft.edgemac.Beta` | `Microsoft Edge Beta` |
| `edge-dev` | Microsoft Edge Dev | `com.microsoft.edgemac.Dev` | `Microsoft Edge Dev` |
| `edge-canary` | Microsoft Edge Canary | `com.microsoft.edgemac.Canary` | `Microsoft Edge Canary` |
| `vivaldi` | Vivaldi | `com.vivaldi.Vivaldi` | `Vivaldi` |
| `vivaldi-snapshot` | Vivaldi Snapshot | `com.vivaldi.Vivaldi.snapshot` | `Vivaldi Snapshot` |
| `opera` | Opera | `com.operasoftware.Opera` | `com.operasoftware.Opera` |
| `opera-gx` | Opera GX | `com.operasoftware.OperaGX` | `com.operasoftware.OperaGX` |
| `opera-developer` | Opera Developer | `com.operasoftware.OperaDeveloper` | `com.operasoftware.OperaDeveloper` |
| `helium` | Helium | `net.imput.helium` | `net.imput.helium` |
| `arc` | Arc | `company.thebrowser.Browser` | `Arc/User Data` |
| `dia` | Dia | `company.thebrowser.dia` | `Dia/User Data` |
| `comet` | Comet | `ai.perplexity.comet` | `ai.perplexity.comet` |
| `chromium` | Chromium | `org.chromium.Chromium` | `Chromium` |

The host detects its own browser at startup: `proc_pidpath(getppid())` → longest-first lowercase substring match on the executable path (helpers' paths contain the browser `.app` path). The needle is that `.app/` folder name, so `google chrome beta.app/` cannot match `chrome`. Helium also matches `helium framework` / `helium helper` / `net.imput.helium`.

Native-host dir is relative to `~/Library/Application Support/`. The installer writes `NativeMessagingHosts/com.lilchromium.relay.json` there when that support directory already exists. Channels do not share a support directory.

## Config file — `~/.lilchromium/config.json`

Written by the app (Settings window / menu). Read by the app and by each host (fresh read per `get-context`). Schema (all fields present; unknown fields preserved on rewrite):

```json
{
  "version": 3,
  "primaryBrowser": "helium",
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
    "provider": "startpage",
    "name": "Startpage",
    "template": "https://www.startpage.com/sp/search?query=%s"
  },
  "hoverBar": {
    "style": "glass",
    "tint": null,
    "revealHeight": 15
  },
  "knownBrowsers": [
    {"slug": "helium", "name": "Helium", "bundleId": "net.imput.helium", "installed": true},
    {"slug": "chrome", "name": "Google Chrome", "bundleId": "com.google.Chrome", "installed": true}
  ]
}
```

- `primaryBrowser`: Primary browser installation for new lils, promotion, palette history, and direct-launch fallback.
- `fallbackBrowser`: second browser installation tried when Primary is unavailable. Settings excludes the current Primary installation while preserving sibling channels as distinct choices.
- `paletteAnchor`: `"top-center"` (centered horizontally, top edge at 20% of screen height) | `"top-right"` (24pt insets).
- `linkBehavior` (v3 semantics): governs links that request a new tab/window (`target=_blank` etc.) from a lil. `"new-lil"` (DEFAULT: cascade into a new lil) | `"same-lil"` (collapse into the current lil — settings copy must warn this can break some sign-in popups). Native popup windows (featureful `window.open`, OAuth) are ALWAYS left alone regardless of this setting. ⌘-click flips the behavior per click.
- `ephemeralDefault`: `"never" | "6h" | "12h" | "24h" | "quit"` — default lifetime for new lils. `"quit"` = excluded from restore-on-startup. Hours = auto-close that long after the lil's last user interaction. Per-lil override lives in the extension registry, set from the hover bar menu.
- `sleep`: resource saver (user-facing name: Lil Nap; the `sleep` key and its sub-fields are legacy internal identifiers). `enabled` + `afterMinutes` (idle before auto-nap), `audioGuard` (skip lils playing audio — toggle, default ON), `formGuard` (skip lils with unsubmitted form input — toggle, default ON), `tint` (`"gray" | "purple"` or `#rrggbb` overlay color), `whitelist` (domains that never auto-nap).
- `searchEngine`: `provider` id + `name` + `template` with `%s` placeholder. `provider` is the explicit Settings selection (`google` | `ddg` | `bing` | `kagi` | `startpage` | `custom`) and is never inferred from `template`. Used by BOTH the palette and the lil hover-bar omnibox. Presets in Settings: Google, DuckDuckGo, Bing, Kagi, Startpage, Custom.
- `hoverBar`: `style` `"glass"` (v0.2 look) | `"solid"` (adaptive title-bar-like background; glass kept only on the address input). `tint` optional `#rrggbb`, applies to either style. `revealHeight` (v4): hover-reveal zone height in px, inclusive 0–48, default 15. The config model is the single clamp site — out-of-range values are clamped on decode and on write, before any host read or broadcast can carry them. `0` disables mouse reveal; ⌘L still reveals and focuses the address field.
- `knownBrowsers`: app scans /Applications + NSWorkspace on launch and on settings-open, writes results. Hosts/extension treat it as read-only truth.
- Missing file/fields → built-in defaults above. A v0.3 `defaultBrowser` value is read as Primary when `primaryBrowser` is absent. Full v0.4 writes emit `primaryBrowser`, upgrade older schema versions to 3, and preserve the legacy key plus every unknown field; newer schema versions are never downgraded. First app launch with no config opens the Settings window (onboarding) and writes it. All writers (app AND host) preserve unknown fields via read-merge-write.

## Transports

- **Extension ↔ host**: Chrome native messaging (unchanged from v1): 4-byte native-endian length + UTF-8 JSON; extension keeps a forever-open `connectNative` port with reconnect backoff.
- **App ↔ host**: Unix domain socket **per browser**: `~/.lilchromium/relay-<slug>.sock` (e.g. `relay-helium.sock`). Newline-delimited JSON. Host binds its own browser's socket; stale-socket rule as v1 (ping-probe live check → exit or unlink+rebind). Host removes its socket on exit (stdin EOF).

### App routing order (link click / palette open)

Incoming URL intake recognizes the dedicated Settings action `lilchromium://settings` before ordinary HTTP/HTTPS routing and presents the singleton Settings window. That URL is never sent as `open` and never launched in a browser.

1. `relay-<primaryBrowser>.sock`
2. `relay-<fallbackBrowser>.sock`
3. any other `relay-*.sock` present (newest mtime first)
4. `NSWorkspace.open` the URL with the Primary browser installation's bundle id (launches it; normal tab)
5. same with Fallback / any installed known browser.
Never `NSWorkspace.shared.open(url)` bare — the app IS the system default handler (infinite loop).

Palette `history-query` uses the same order but only steps 1–3 (no launch), returning empty items if no socket answers.

## Messages

All JSON with `type`. `id` for request/response matching.

### app → extension (via socket → port)

- `{"type":"open","url":string,"left":int,"top":int,"incognito":bool?,"priorContext":{"kind":"external-app","pid":int,"bundleId":string?}?}` — open a lil. Before sending, the app records the regular app the user last activated — watched from launch via `NSWorkspace` activation and termination notifications, never read from the frontmost app at send time, because LaunchServices has often made the app itself frontmost by the time a link arrives — as a PID with optional bundle-ID fallback. The extension uses it as the lil's first prior context only when Chromium has no focused window; otherwise it records the focused registered lil or related normal window (see *Prior context and focus discipline*). The field is optional for compatibility with earlier senders. Coordinates as v1 (Chrome screen coords, app pre-flips Y). Extension applies remembered size, clamps, registers. `incognito:true` (palette ⌘-Enter) → incognito lil: requires the extension's Allow-in-Incognito toggle; if `chrome.extension.isAllowedIncognitoAccess()` is false, open a normal lil to a page/notification explaining the toggle instead of dropping the URL.
- `{"type":"history-query","id":string,"text":string,"maxResults":int}` → reply `history-result` as v1.
- `{"type":"config-update","primaryBrowser":slug,"primaryBrowserName":string,"fallbackBrowser":slug,"linkBehavior":...,"ephemeralDefault":...,"sleep":{...},"searchEngine":{...},"hoverBar":{...},"knownBrowsers":[{"slug":...,"name":...,"installed":bool}]}` — hot-apply (v4). On EVERY native Settings write the app publishes the normalized full configuration (the `context` config fields minus host identity) to EVERY live `relay-*.sock`, slug-sorted — not only the routing target. The host forwards the line verbatim to its extension and never queues it. The worker replaces the config half of its cached context (its own `browser`/`browserName` stay) and pushes the normalized result to every live lil (registered and incognito) as a `contextUpdate` tab message; overlays apply style/tint/reveal-zone and label changes immediately. A relay that misses the broadcast catches up on the extension's next port (re)connect: `get-context` is always answered from a fresh config.json read, and that fresh `context` is likewise pushed to every live lil.

### extension → host (host handles directly; never reaches the app)

- `{"type":"get-context","id":string}` → host replies on the port:
  `{"type":"context","id":string,"browser":slug,"browserName":string,"primaryBrowser":slug,"primaryBrowserName":string,"fallbackBrowser":slug,"linkBehavior":"new-lil"|"same-lil","ephemeralDefault":string,"sleep":{...},"searchEngine":{...},"hoverBar":{...},"knownBrowsers":[{"slug":...,"name":...,"installed":bool}]}`
  (v3: context carries the full config objects verbatim from config.json plus the host's browser identity.)
  Host reads config.json fresh on every call and injects its own detected identity. Extension calls this on every port (re)connect and caches.
- `{"type":"open-external","browser":slug,"url":string}` — host launches the URL in that browser via `open -b <bundleId> <url>` (or NSWorkspace equivalent). Fire-and-forget; host logs failures.
- `{"type":"restore-focus","priorContext":{"kind":"external-app","pid":int?,"bundleId":string?}}` — extension asks the host to reactivate the external app a closing lil's prior context names. The host resolves that app from its own activation history first: the most recently activated regular app other than the host's browser that is still running, watched via `NSWorkspace` activation and termination notifications for the life of the host and seeded from the frontmost app at host start (ADR-0004: the app the user actually left, not the one recorded when the lil opened). Only when the host has no history does it fall back to the `pid` the app recorded at open time; `bundleId` accompanies a `pid` and is never sent alone. A pid-less context is normal: the user came back to the browser from outside it, which Chromium reports only as no focused window. Activation tries the exact process, then an eligible live process with the same bundle ID, then a LaunchServices open of that bundle. If no history and no pid, or no eligible process, exists it does nothing; it never substitutes a browser window.
- `{"type":"whitelist-op","op":"add"|"remove","domain":string}` — host merges the change into `config.json` → `sleep.whitelist` (atomic read-modify-write, preserves all other fields, dedupes). Lets the extension's context menus edit the whitelist. App's Settings window reads the file fresh on open.
- `{"type":"open-settings"}` — extension asks the host to open native Settings. Host never forwards the message and never opens a browser; it launches the dedicated app-owned URL `lilchromium://settings` targeted at bundle id `com.lilchromium.app` (`open -b`). Fire-and-forget. The app receives that URL through ordinary URL intake.

### host-only (socket side, never forwarded)

- `{"type":"ping","id"}` → `{"type":"pong","id","extensionConnected":bool,"browser":slug}` (browser field new in v2).

### Private diagnostic control (issue #30, not product behavior)

- `{"type":"lil-focus-trace","op":"arm"|"disarm"|"snapshot"|"close-lil", …}` — LILFOCUS, the diagnostic seam of the real-Mac focus loop (`scripts/focus-loop.mjs`). Written to a relay socket by that harness only; **never sent by the app or the host**. One explicitly tagged operation per message, carrying only its own payload:
  - `arm` — `{"runId":string,"port":int,"ttlMs":int?}`. The extension **derives** its collector endpoint as `http://127.0.0.1:<port>/t/<runId>`; no endpoint is ever carried on the wire, so a control line cannot redirect the stream off the loopback interface or out of the run's own path. `runId` is `[A-Za-z0-9._-]{1,64}` (it is a URL path segment). TTL defaults to 15 minutes and is capped at 30, so a forgotten run disarms itself.
  - `disarm` — no payload. Stops the stream at once.
  - `snapshot` — `{"label":string}`. Emits one window reading under that label.
  - `close-lil` — `{"runId":string,"windowId":int}`. Teardown between bounded repetitions, never a measurement. The extension closes the window **only** when the run id matches the armed run, the window is one that same armed run opened, and it is still a registered lil; Primary, a foreign lil, and a stale id are inert and are reported back as such. This is the seam's only mutating operation.

  The host validates the line (`mac/Sources/LilShared/FocusTraceControl.swift`) and forwards only operations this contract defines, logging every decision under `[LILFOCUS]`; anything else is dropped, not forwarded. The extension (`extension/focus-trace.js`) ignores every operation while disarmed, is disarmed again by any service-worker restart, and never reads or writes this state from a page or from storage. Removing the seam entirely means deleting the sites `grep -rn LILFOCUS extension mac scripts docs` lists. Cleanup check: `node scripts/focus-loop.mjs cleanup`.

### Queueing

As v1: host queues `open` (max 20 FIFO) while the port is down; `history-query` gets an immediate empty `history-result`.

## Extension behavior contract (v2 changes)

- **Naming**: user-facing copy says "lil"/"lils" (e.g. "Open in a new lil").
- **Hover-reveal top bar** replaces the always-visible pill. Hidden by default (nothing covers page UI). Reveal when cursor is within `hoverBar.revealHeight` px of the viewport top (~80ms intent delay) or on ⌘L; hide 300ms after the cursor leaves unless the address field is focused or a menu is open; Esc hides. The mousemove handler reads the live config value on every event: a `0` zone disables mouse reveal (⌘L still reveals and focuses the address field), and a zone change applies to existing overlays without a reload (see `config-update`). While the address field or its suggestions own focus, `keydown`/`keyup`/`keypress` are consumed at that overlay editing boundary so the host page cannot observe or act on them; native insertion, paste, selection, deletion, arrows, and input methods are not canceled, and page shortcuts remain active when the boundary does not own focus. Bar (closed shadow DOM, slides down, glass-look CSS backdrop-blur, adapts to `prefers-color-scheme`): [back button] [editable address field, centered — shows current URL compactly, full URL + select-all on focus, Enter navigates via SW `tabs.update` (add https:// when missing; non-URL input → search via config `searchEngine.template`)] [**Open in {primaryBrowserName}** ⌘O] [⌄ caret menu].
- **Caret menu**: promote to Primary; "Open in {host browser} tab" when Host ≠ Primary; tab groups of the Host browser (`tabGroups.query`); other installed browsers ("Open in {name}…" → `open-external`); "Settings…" (posts `open-settings` to the host — a request for native Settings, not duplicated global controls); "Close lil".
- **Promote semantics**: if `primaryBrowser` is the installation the lil lives in → v1 no-reload move (`tabs.move` → `windows.create({tabId})` fallback) + optional group. Else → `open-external` to Primary + close the lil (state not preservable across browsers — accepted).
- **⌘O** (content-script capture + `promote-tab` command backstop) = promote to Primary. **⌘L** = reveal + focus address bar. Those two keys stay fixed in the overlay; they are not remappable extension commands. `promote-tab` keeps its suggested `Command+Shift+O` / `Ctrl+Shift+O` backstop. `let-this-lil-nap` (“Let This Lil Nap”) is registered with no `suggested_key` so Chromium’s shortcut UI lists it unassigned until the user chooses a key.
- **New-window link handling (v3 — replaces v2 collapse logic; classification refined in v4, issue #16)**: on `onCreatedNavigationTarget` from a lil, WAIT for the tab to settle (retry `tabs.get`/`windows.get`), then branch:
  1. Settled window `type === "popup"` OR the requested or settled URL matches the OAuth guard list → **native popup/auth flow, do not touch** (no re-parent, no navigate, no registry). This preserves `window.opener`/postMessage — the Google-auth fix. A missing `openerTabId` alone is NOT decisive: an opener-less spawn that landed as a normal-window tab (e.g. `rel="noopener" target=_blank`) is a genuine requested target and follows branch 2.
  2. Landed as a tab in a normal window → effective behavior = config `linkBehavior` flipped by ⌘ clickHint: `new-lil` → re-parent into a new cascaded lil (create → `update({focused:true})`); `same-lil` → navigate the source lil's tab, close the spawned tab, then **explicitly re-focus the source lil's window** (focus must never remain on the main window).
- **Attributable new-tab conversion (v4, issue #18)**: a browser-created tab (Command+T, or a current-browser utility open) converts into a lil only when public events tie it to one: at the `tabs.onCreated` event, `windows.onFocusChanged` still names a registered lil, the tab is active and opener-less, and it landed as a new tab in the already-populated normal window most recently focused per `onFocusChanged` (destination attribution only — a stale id yields safe non-conversion, never a restore/predecessor fallback). Conversion re-parents the tab through the shared lil lifecycle with `priorContext {"kind":"lil","windowId":<source lil>}`. Attribution rests on public event identity only — no timestamps, delays, sender heuristics, or browser blacklists. **Ownership order**: a tab named by `webNavigation.onCreatedNavigationTarget` belongs to the new-window link flow no matter which listener runs first (Chromium raises `tabs.onCreated` for the spawned tab before the navigation claim); the link flow's leave-alone rules (popup window, OAuth guard) always win, and the new-tab flow likewise leaves any OAuth-guard URL untouched. When the tie is incomplete — focus moved, `WINDOW_ID_NONE`, background tab, foreign/empty/popup destination window, or a link-owned tab — the tab is left exactly where Chromium put it. Extension-only behavior: no message, socket, config, app, or host change.
- **Prior context and focus discipline (v4; live history per ADR-0004, issue #31)**: a lil's prior context is its live focus history, as if the lil were its own app. A focused create records exactly one eligible starting context: `{"kind":"lil","windowId":int}`, `{"kind":"normal-window","windowId":int}`, or the app-provided external-app object above when no browser window is focused; nested creates explicitly name their source lil. Thereafter each focus change onto a registered lil that the user made replaces it with the context they came from: the previously focused registered lil, the previously focused normal window, or `{"kind":"external-app"}` with no `pid` when Chromium had no focused window (`windows.onFocusChanged(WINDOW_ID_NONE)` is meaningful external focus state). Focus that came from a non-lil popup leaves the history untouched. Two kinds of focus change are not the user's and never rewrite it: focus the extension asked for (creation focus, close-driven restoration, the same-lil refocus), and Chromium's key handoff to a sibling when a focused window closes — on macOS that handoff's `onFocusChanged` precedes the window's `onRemoved`, so whether a closing lil was focused is read when its tab is torn down (`tabs.onRemoved`), and the handoff's rewrite is reverted when `onRemoved` follows. Every focused lil create = `windows.create` then immediate `windows.update(id,{focused:true})`; geometry updates never include `focused`. When a focused lil closes, consult its prior context once before deleting its registry/capture state: focus that exact window only if it is still live and still the recorded kind, or send `restore-focus` for an external app. The restoration runs at that `tabs.onRemoved` teardown reading, while the lil still holds key, whenever the removal closes the window: Chromium flags it `isWindowClosing` on the closing paths it knows (red button, `windows.remove`), and a ⌘W close removes the lil's only tab unflagged, after which the emptied window closes on its own — the extension keeps each window's live tab ids from tab events, so the last-tab removal is recognized synchronously as the same reading. A restoration that waits for `windows.onRemoved` lands after the key handoff, and the sibling that handoff raised stays above the user's other apps. A removal that leaves the lil open (one tab of two, during a wake swap) restores nothing; a close this reading did not catch restores at `windows.onRemoved` as before. A stale context is ignored; there is no normal-window MRU fallback. Startup restoration preserves recorded contexts and remaps lil IDs to their newly restored windows; that parked context is the fallback only until the user first focuses the restored lil. Unfocused restart restoration remains exempt from focus requests.
- **Ephemerality (v3)**: registry entries carry `{expiry: "never"|"quit"|hoursNumber, lastInteraction: ts}` seeded from config `ephemeralDefault`; hover-bar caret menu sets per-lil override. A 1-minute `chrome.alarms` sweep (persistAcrossSessions) closes hour-based lils idle past their limit; `"quit"` lils are skipped by restore-on-startup. Content script reports interaction (debounced) to refresh `lastInteraction`.
- **Lil Nap (v4 entry)**: manual (caret menu / page context menu / unassigned `let-this-lil-nap` command “Let This Lil Nap”) + auto (config `sleep.enabled`, idle > `afterMinutes`, same sweep alarm). Manual entry stays available while `sleep.enabled` is false. Guards, each skipping auto-nap only: `audioGuard` (`tab.audible`), `formGuard` (content script dirty-form tracking per research-v0.3.md), whitelist domains, focused lils, incognito lils. Entry captures the visible lil (`captureVisibleTab(windowId,{format:"jpeg",quality:60})`, throttled ≤2/sec, sequential via the shared `throttledCapture` path), stores the Blob in IndexedDB (`unlimitedStorage`) under a capture identity, and records original URL, original title, and that identity on the registry **before** releasing the original document. Release navigates to `sleep.html` by replacing the current history entry (`location.replace`); the nap URL must not sit on top of the live page in back/forward. Replacement is the only release path — there is no history-pushing fallback: if the document cannot be replaced, entry fails, the live document stays untouched, and the recorded nap registry fields and fresh capture are rolled back. The napping document title is the original title prefixed with `💤 `. The page shows the screenshot under a tinted overlay (config `sleep.tint`), the existing card icon at roughly 167% of its prior size, and “Shhh… this lil is napping.” **Wake (v4)**: click-anywhere on the nap page asks the worker to wake the lil. The worker begins loading the original URL at once in an inactive tab of the same lil window while the static nap image stays painted, then swaps as soon as the fresh page is ready — `status: "complete"`, observed by event or already complete when the worker inspects the tab after subscribing its listener — never before a 180 ms image floor, and never waiting past a 500 ms cap, at which the swap proceeds regardless. The swap activates the fresh tab and removes the nap tab, so wake produces a fresh document (never a resumed one) and leaves no internal nap URL in back/forward history. Wake reports success only once a fresh active document has actually replaced the nap document: activation failure drops the preload and leaves the already-visible nap document in front; nap-tab removal failure reactivates the nap document and drops the preload; both leave nap state intact and report failure. On success the worker clears the nap-only registry fields (`slept`, `sleepCaptureKey`, `originalUrl`, `originalTitle`) while keeping the lil registered, and deletes the capture. If the preload tab cannot be created, the worker holds the floor and releases the nap document through entry's replacement-only path; if no fresh navigation can be produced at all, wake reports failure and leaves nap state intact. The nap page's own fallback (`location.replace` to the original URL) fires only after an explicit worker failure or genuine unreachability — a message error, or no reply 1000 ms after asking (past the worker's cap plus reply margin) — never in parallel with the worker's bounded path. It starts reconciling the registry and deleting the capture itself, but waits only a bounded time before navigating so a hung storage or IndexedDB call cannot strand the nap document; leftover nap state is still reconciled by the worker when the visible document leaves the nap URL. Registry + capture + the nap URL with `tab.discarded == false` are the Lil Nap oracle. Native discard keeps the original URL and reports `discarded == true`; freeze reports `frozen == true` without a new document. Incognito lils are never captured or napped. Restore reopens recorded napping lils as nap documents rebuilt with the current configured `sleep.tint`, not live loads of the original page.
- **Hover bar additions (v3)**: reload button + copy-URL button (copy shows a brief "Copied" tick). **Omnibox**: address field input shows a suggestions dropdown — fuzzy history matches via `chrome.history.search` ranked origin-first (port the v0.2 palette ranking: host-prefix > title word-boundary > contains > dense fuzzy, × frecency, dedupe by host+path, ≤3 per host), plus a "Search {engine} for …" row (config `searchEngine.template`); arrow keys + Enter; Esc closes dropdown first, bar second. **Style**: config `hoverBar.style` — `glass` (v0.2 look) or `solid` (opaque adaptive background matching light/dark title-bar tones, glass only on the address input); optional `hoverBar.tint` recolors either.
- **Incognito lils (v3)**: `open.incognito` from the palette, caret-menu "Reopen in incognito lil", context-menu "Open link in incognito lil". Gate on `isAllowedIncognitoAccess()`. Palette and caret-menu: if off, fall back to a normal lil + notification pointing at the extension's Allow-in-Incognito toggle. Context-menu "Open link in incognito lil": if off, or if incognito create fails, explain on the source page and do not open, drop, or de-privatize the URL. Incognito lils: never in restore registry, never napped, never captured.
- **Context menus** (created in `onInstalled`; one policy owns both visibility and click authorization): "Open link in this lil" only inside a registered lil; "Open link in new lil" and "Open link in incognito lil" from eligible normal and registered-lil page contexts (`contexts:["link"]`). Incognito pages omit this-lil, new-lil, and send so a private URL cannot be moved into a normal window. Page context in lils: "Let This Lil Nap", "Never nap {domain}" / "Allow napping {domain}" (→ `whitelist-op`). Page context in NORMAL non-incognito windows: **"Send to lil"** (re-parent the selected tab through the shared lil lifecycle). Tab-strip **"Send Tab to Lil"** (`contexts:["tab"]`) uses that same reparent/register operation; if the browser rejects the `tab` context, omit that item and still load every other menu.
- Registry/size-memory/history-responder behavior otherwise remains unchanged from v1. Restore skips `"quit"`-expiry lils, reopens napping lils as nap documents, and applies the prior-context remapping above.

Native app activation does not require Accessibility permission. The contract does not promise strict sibling-window z-order inside another application; it promises only a best-effort public activation request for the recorded application.

## App behavior contract (v2 changes)

- Palette: anchor per config (`top-center` default: centered horizontally, panel top at 20% of the primary display's visibleFrame height). Dismiss ONLY on: Esc, ⌘⌥N toggle, X button, opening a result, or showing Settings (v4 — a floating panel must not cover the normal-level Settings window). NOT on app deactivation (user can visit Raycast/pasteboard and come back). Panel level stays `.floating`, `.nonactivatingPanel`, visible across Spaces. Persistent gear control and a selectable Settings result (the complete case-insensitive words “settings” and “preferences” only) both close the palette then present Settings; they never send `open`.
- Palette sends `open` anchored near the panel; link clicks anchored at mouse (unchanged).
- Settings window (Liquid Glass mini window), organized into three sections (v4):
  - **General** — Primary browser picker (installed only), Fallback browser, palette position, search engine (presets + custom template), launch-at-login.
  - **Lils** — link behavior (with the "may break sign-in popups" warning on same-lil), ephemerality default, Lil Nap (enable, minutes, audio guard toggle, form guard toggle, tint, whitelist editor).
  - **Hoverbar** — style (Glass / Solid) + optional tint + reveal-zone slider (0–48 px, default 15).

  Singleton: one controller and one window for the life of the process; every entry point reaches it. Opens automatically on first run (no config.json). Reads config fresh and re-scans installed browsers on every open (the host may have edited the whitelist). Every write saves atomically and then publishes `config-update` to every live relay (v4 hot-apply — see Messages), so all live relays and lils converge without waiting for a reconnect. Showing it activates Lil Chromium only — it never opens or focuses a browser window. **Placement (v4)**: first presentation matches the centered palette geometry (horizontally centered, top edge at 20% of the visibleFrame height) on the primary display; once the user moves it, AppKit frame autosaving under `LilChromiumSettings` takes over.
- Palette: fixed width (620) — long titles truncate at the tail, URLs truncate at the head; the panel NEVER widens. Search row uses config `searchEngine`. **⌘-Enter** opens the selection as an incognito lil (`open.incognito:true`).
- Status item menu: "New Lil ⌘⌥N", "Settings…", "Set as Default Browser…", separator, "Quit".
- Application menu bar (v4): the app is `LSUIElement`, so macOS never draws this menu — it exists because `NSApplication.sendEvent(_:)` routes ⌘-key events through `NSApp.mainMenu` before the key window's responder chain, which is the only way ⌘, and native text editing work. **App** — About, separator, "Settings… ⌘,", "Set as Default Browser…", separator, "Quit ⌘Q". **Edit** — Undo/Redo, Cut/Copy/Paste/Paste and Match Style/Delete/Select All, all nil-targeted so they resolve against the current field editor (Settings fields and the palette input alike). **Window** — Minimize ⌘M, Zoom, Close ⌘W (`NSApp.windowsMenu` is deliberately unset).

## Installer contract

`scripts/install-host.sh` writes the manifest into every existing browser dir among the catalog's native-host dirs (see Browser slugs): `Google/Chrome`, `Google/Chrome Beta`, `Google/Chrome Dev`, `Google/Chrome Canary`, `BraveSoftware/Brave-Browser`, `BraveSoftware/Brave-Browser-Beta`, `BraveSoftware/Brave-Browser-Dev`, `BraveSoftware/Brave-Browser-Nightly`, `Microsoft Edge`, `Microsoft Edge Beta`, `Microsoft Edge Dev`, `Microsoft Edge Canary`, `Vivaldi`, `Vivaldi Snapshot`, `com.operasoftware.Opera`, `com.operasoftware.OperaGX`, `com.operasoftware.OperaDeveloper`, `net.imput.helium`, `Arc/User Data`, `Dia/User Data`, `ai.perplexity.comet`, `Chromium` (each under `~/Library/Application Support/`, + `/NativeMessagingHosts/com.lilchromium.relay.json`). A dir is "existing" when that support directory is already present; missing installations are skipped, not created. Helium does NOT read Chrome's manifests — its own dir is required. Channels do not share a support directory.

## Coordinates / filesystem layout

Unchanged from v1 (see git history for the v1 text). Sockets now `relay-<slug>.sock`; favicon cache `~/.lilchromium/favicons/`; logs `~/.lilchromium/host-<slug>.log`.
