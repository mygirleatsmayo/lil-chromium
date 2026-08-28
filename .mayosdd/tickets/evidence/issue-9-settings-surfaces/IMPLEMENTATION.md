# Issue #9 — Open native Settings from every surface

Branch: `surfx/implement-issue-9-native-settings-from-e-j1BjrAvT`
Scope: issue #9 only. Existing #7 / #14 / #15 work was left in place. No live
install, launch, reload, or quit of the running app, browser, extension, or
native host.

## Agreed seams

No new test seam. Tests stay on the already-agreed public boundaries:

1. **Native model / router / config / contract** — `LilShared` message types,
   `SettingsAction` URL/launch contract, `URLIntent.destination`, palette
   `rows` / `action`, PROTOCOL lockstep.
2. **Production MV3 service-worker harness** — real `extension/background.js`
   against the fake Chrome API; shared JSON fixtures in repo-root `fixtures/`.

Not tested here (manual real-Mac QA): AppKit window placement/restoration,
palette gear hit-testing, caret-menu click in a live lil, Launch Services
delivery of `lilchromium://settings` to the installed app.

## Shared contract

- Message: `{"type":"open-settings"}` (`fixtures/message-open-settings.json`).
- Dedicated action: `lilchromium://settings`, targeted at bundle id
  `com.lilchromium.app` via `open -b`.
- App classifies that URL **before** HTTP/HTTPS routing and calls the same
  `PaletteController.requestSettings()` path used by the menu, gear, and
  palette Settings row: close the palette, then `SettingsWindowController.show()`.
- Host never forwards the message and never launches a browser.
- Extension never duplicates global preference controls; the lil caret item
  only posts the command.

## Red-green slices

### 1. Message fixture

- **Red:** `openSettingsIsTypeOnly` — `OpenSettingsMessage` missing.
- **Green:** `MessageType.openSettings` + type-only `OpenSettingsMessage`.
  Fixture added to the shared Node list.

### 2. Dedicated action before HTTP routing

- **Red:** `SettingsActionTests` — type missing; `URLIntent.destination` missing.
- **Green:** `SettingsAction` (URL, bundle id, `openArguments`, `matches`) and
  `URLIntent.destination` (`.settings` vs `.open`).

### 3. Palette discoverability

- **Red:** `PaletteSettingsAccessTests` — `PaletteRow.Kind.settings` missing.
- **Green:** Settings row leads for case-insensitive prefixes of “settings”
  (≥ `set`) and “preferences” (≥ `pref`). Empty / unrelated queries stay
  unchanged. Row `actionURL` is `SettingsAction.urlString`.

### 4. Palette action is Settings, not Open

- **Red:** `PaletteAction.Kind.settings` missing.
- **Green:** plain Return and ⌘-Return on the Settings row yield `.settings`
  (never an incognito lil). Shift-Return still forces Search (#14).

### 5. Extension command does not raise a browser window

- **Red:** `opening Settings from a lil posts open-settings…` — `ok === false`.
- **Green:** runtime `openSettings` posts the shared fixture and issues no
  `windows.create`, no focusing `windows.update`, and no `open-external`.

### 6. Production wiring + protocol lockstep

- **Red:** `protocolAndBundleDeclareTheDedicatedAction` — PROTOCOL and
  `bundle-app.sh` lacked the command / URL / scheme.
- **Green:** host `handleOpenSettings`, app URL intake, palette gear +
  `requestSettings()`, overlay “Settings…”, `lilchromium` URL scheme, PROTOCOL
  updates. Existing Settings singleton and frame autosave (`LilChromiumSettings`)
  unchanged.

## Changed files

| File | Why |
|---|---|
| `docs/PROTOCOL.md` | `open-settings`, dedicated URL, pinned app bundle id, palette gear/result, caret item |
| `fixtures/message-open-settings.json` | Shared wire fixture |
| `scripts/bundle-app.sh` | Register `lilchromium` URL scheme |
| `mac/Sources/LilShared/SettingsAction.swift` | Shared URL / launch / query contract |
| `mac/Sources/LilShared/Messages.swift` | `open-settings` type + message |
| `mac/Sources/lilchromium-host/main.swift` | Launch dedicated action; never a browser |
| `mac/Sources/LilChromiumApp/URLIntent.swift` | Settings-first intake classification |
| `mac/Sources/LilChromiumApp/AppDelegate.swift` | Incoming Settings URL → `showSettings()` |
| `mac/Sources/LilChromiumApp/PaletteController.swift` | Gear, `requestSettings()`, Settings row activation |
| `mac/Sources/LilChromiumApp/PaletteModel.swift` | Settings row + action |
| `mac/Sources/LilChromiumApp/PaletteRowView.swift` | Gear icon for Settings rows |
| `extension/background.js` | `openSettings` → `open-settings` |
| `extension/overlay.js` | Caret “Settings…” |
| `mac/Tests/LilChromiumTests/MessageTests.swift` | Fixture decode / encode |
| `mac/Tests/LilChromiumTests/SettingsActionTests.swift` | URL, routing, PROTOCOL lockstep |
| `mac/Tests/LilChromiumTests/PaletteTests.swift` | Discoverability + action |
| `extension/test/fixture.test.js` | Shared fixture list |
| `extension/test/worker.test.js` | No window create/focus |
| `.mayosdd/tickets/evidence/issue-9-settings-surfaces/IMPLEMENTATION.md` | This note |

## Commands and results

| Command | Result |
|---|---|
| Focused red-green `swift test --filter …` / `pnpm exec node --test …` | Each slice red, then green, as above |
| `pnpm test` | 39 pass, 0 fail |
| `swift test` in `mac/` | 152 tests in 15 suites passed |
| `make app` | Built `mac/build/LilChromium.app`; Info.plist includes `lilchromium` scheme |
| `git diff --check` | Clean |

Did **not** run `make install`, `make install-app`, `make install-host`, or
`scripts/install-host.sh`. Did not launch, reload, or quit the live app,
browser, extension, or native host.

## Remaining real-Mac QA

These require the installed app (and a live extension) and were left manual:

1. Palette gear and Settings result close the palette, then show the existing
   Settings window at its saved frame (or first-placement geometry if never
   moved).
2. ⌘, while the palette is open still reaches the same window.
3. Lil caret “Settings…” opens native Settings without creating or focusing a
   Host-browser window.
4. After install, `open -b com.lilchromium.app lilchromium://settings` delivers
   the URL to the running agent.
