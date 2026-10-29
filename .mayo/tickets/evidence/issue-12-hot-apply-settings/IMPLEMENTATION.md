# Implementation evidence — issue #12 (hot-apply global settings)

Branch: `surfx/implement-issue-12-hot-apply-global-sett-hu1JPQ_r`
Ticket: `gh issue view 12` (9 ACs) · Parent: #2 (IDs 17–19, 38, 51; US 27–28, 60–63; Testing Decisions 4, 8).

## Agreed seams (unchanged, no new seam created)

1. **Native model/router/config/contract boundary** — Swift `LilShared` (config, messages, merge) + `LilChromiumApp` (RelayClient routing/broadcast), exercised by `LilChromiumTests` against repo-root `fixtures/`.
2. **Production MV3 service-worker harness** — Node VM running the real `extension/background.js` against the fake Chrome/IndexedDB, asserting port traffic, `tabs.sendMessage` fanout, and registry state; same `fixtures/`.

Not seams (by agreement): the host socket loop (executable; build-verified, its wire behavior pinned by the fixtures the JS suite consumes) and the overlay content script (no DOM harness; code-reviewed, manual QA below).

## Contract change (landed atomically in all components)

- `hoverBar.revealHeight`: Int px, default **15**, inclusive range **0–48**. The Swift config model is the single clamp site (decode + every write); hosts reading config.json and app broadcasts therefore always carry an in-range value; the extension boundary only type-checks (non-number → 15), matching how `normalizeContext` already coerces `linkBehavior`/`style`. `0` disables mouse reveal; ⌘L path never consults the zone.
- New wire message **`config-update`** (app → every live `relay-*.sock` → host forwards verbatim → worker): the normalized full configuration, i.e. the `context` config fields minus host identity (`browser`/`browserName` stay the worker's own). No bundle ids on the wire, same as `context`. Never queued by the host: a missed relay catches up from config.json via the fresh-read `get-context` on the extension's next port (re)connect, and that fresh `context` is also fanned out to lils.
- Worker → every live lil: `{action:"contextUpdate", context}` tab message (registered lils + in-memory incognito lils). Overlay swaps context and re-applies style/tint/promote label immediately; the mousemove handler reads the live reveal zone per event.
- Lockstep: `docs/PROTOCOL.md` (config schema, hoverBar bullet, Messages, extension hover-reveal, Settings sections), fixtures (`message-config-update.json` new; `config-v3-complete.json`/`message-context.json` carry `revealHeight: 24`; `config-with-unknown-fields.json` deliberately lacks it to pin the additive default).

## Red → green slices

1. **Swift config** — RED: `RevealHeightTests` (absent→15 via v1-legacy + unknown-fields fixtures; 100→48/-5→0 on decode; write-clamp; zero round-trips) + `canonicalV04ConfigDecodesVerbatim` expecting 24 from the fixture (compile error: no `revealHeight` member). GREEN: `HoverBarConfig.revealHeight` with `didSet` clamp + `clampRevealHeight`/`revealHeightRange`/`defaultRevealHeight`.
2. **Swift contract** — RED: `MessageTests.configUpdate*` (fixture decode, closed key set, no bundle ids, `init(config:)` normalization incl. clamped broadcast, catalog fallback) — compile error: no `ConfigUpdateMessage`. GREEN: `MessageType.configUpdate`, `ContextPayload` (trimmed browsers + display-name resolution), `ConfigUpdateMessage`. The host's existing `handleGetContext` mapping was left untouched (no test coverage of its internals; zero regression risk to #7).
3. **Swift router** — RED: `broadcastTargets` missing. GREEN: slug-sorted/deduped/non-empty fanout targets; `broadcastConfig` sends one `config-update` line to every live socket (fire-and-forget per relay); `broadcastConfigAsync` serializes bursts on a dedicated queue so relays see write order. `SettingsStore.config didSet` (the single Settings write point) saves then broadcasts. Launch-time scan merges (`AppDelegate`, `SettingsStore.init`) deliberately do not broadcast — not Settings writes; relays catch up on connect.
4. **SwiftUI** — Hoverbar section: `LabeledContent("Reveal zone")` + `Slider` (0…48, step 1, range from the model constants) + px readout + caption. Build-verified; UI not unit-tested (not a seam).
5. **Host** — explicit `config-update` socket case forwarding verbatim (previously reachable only via the undocumented `default` bucket). Build-verified.
6. **JS worker** — RED: 4 new tests + 2 fixture-equality assertions failed (identity-preserving replace; per-lil fanout incl. incognito; future-lil seeding vs per-lil override; reconnect catch-up; `revealHeight` additive default; config↔context fixture parity). GREEN: `applyConfigUpdate` (replace config half of cached context, keep `browser`/`browserName`), `broadcastContextToLils` (reuses existing `broadcastToWindow`), `context` handler also fans out (catch-up convergence), `normalizeContext` revealHeight. Harness fidelity fix: fake `disconnectPort()` now drops the dead port's listeners so a reconnect doesn't double-deliver (matches real Chromium).
7. **JS overlay** — `contextUpdate` listener in `mountUI`; `HOVER_STRIP_PX` (24) replaced by live `hoverBar.revealHeight` read; `zone > 0 &&` gate makes 0 never-near-top (an already-shown bar still hides normally); ⌘L → `focusAddress` untouched. Syntax-checked; visual behavior is manual QA (below).

## Multi-relay / multi-lil / reconnect evidence

- **Normalized ordering (multi-relay):** `broadcastReachesEveryLiveRelayInNormalizedOrder` — `[vivaldi, chrome, brave, chrome, ""]` → `[brave, chrome, vivaldi]`; empty set → no targets (file remains the catch-up truth). Real socket fanout not exercised in tests: binding test sockets under `~/.lilchromium` would interfere with the live installation (forbidden); the pure router boundary is the agreed seam (same pattern as #7's `socketOrder`).
- **Tint/reveal updates (multi-lil):** `a config update is pushed to every live lil, including incognito ones` — 3 lils (2 registered + 1 incognito) each receive exactly one `contextUpdate` carrying tint `#4455ff`, revealHeight `8`, primary `vivaldi`, and no bundle ids.
- **Future-lil seeding:** `future lils seed from the new config without overwriting per-lil overrides` — lil A seeds `6h`→6, Keep-menu override → `"never"`; after the `12h` broadcast lil B seeds 12 while A stays `"never"`.
- **Disconnect + reconnect:** `a relay that missed the broadcast catches up from the file on reconnect` — port disconnect → worker re-asks `get-context` after reconnect backoff (~250 ms; test waited 400 ms) → fresh `context` (config-update payload) → cache replaced (`vivaldi`, revealHeight 8) → the live lil receives exactly one `contextUpdate` with the new tint.
- **Clamping:** enforced once in the Swift model (`RevealHeightTests`); extension tests assert consumers receive the normalized value. Zero disables mouse reveal while ⌘L still reveals + focuses (overlay gate + untouched `focusAddress`; manual QA below).

## Commands and results

- `swift test` (mac/): **150 tests / 14 suites passed** (was 139; +11 new).
- `pnpm test`: **42 tests passed** (was 38; +4 new, 2 extended).
- `make app`: release build succeeded (bundle in `mac/build/LilChromium.app`). No install step run (live environment untouched).
- `git diff --check`: clean.
- `node --check extension/background.js extension/overlay.js`: clean.

## Changed files

- `mac/Sources/LilShared/Config.swift` — `HoverBarConfig.revealHeight` + clamp.
- `mac/Sources/LilShared/Messages.swift` — `MessageType.configUpdate`, `ContextPayload`, `ConfigUpdateMessage`.
- `mac/Sources/LilChromiumApp/RelayClient.swift` — `broadcastTargets` / `broadcastConfig` / `broadcastConfigAsync`.
- `mac/Sources/LilChromiumApp/SettingsWindow.swift` — didSet fanout; reveal-zone slider.
- `mac/Sources/lilchromium-host/main.swift` — explicit `config-update` forward.
- `extension/background.js` — normalize/default revealHeight; `applyConfigUpdate`; `broadcastContextToLils`; context-reply fanout.
- `extension/overlay.js` — `contextUpdate` listener; live reveal zone with zero gating.
- `extension/test/{chrome.js,harness.js}` — truthful port disconnect + `disconnect()` helper.
- `extension/test/{worker.test.js,fixture.test.js}` — hot-apply suite + fixture registry.
- `fixtures/message-config-update.json` (new), `fixtures/config-v3-complete.json`, `fixtures/message-context.json`.
- `docs/PROTOCOL.md` — contract lockstep.

## Manual real-Mac QA remaining (live environment untouched by this task)

1. Settings → Hoverbar: drag the reveal-zone slider; verify every open lil's hoverbar reveal reach changes live, tint/style change live, and `0` stops mouse reveal while ⌘L still opens the address field.
2. Two browsers running the extension: change tint; verify lils in BOTH browsers update without restart.
3. Quit one browser, change a setting, relaunch that browser: verify its lils converge from the reconnect `get-context`.
