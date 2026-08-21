# Issue #20 — Enter Lil Nap safely and truthfully

Branch: `surfx/implement-issue-20-enter-lil-nap-safely--C5JeK73j`
Scope: enter and restore Lil Nap. Wake timing (#21), policy/shortcut (#22), and brand family (#24) were not implemented.

## Agreed seam

Production MV3 service worker in Node (`extension/test/harness.js` loads `extension/background.js`) against the fake Chrome / IndexedDB boundary from issue #4.

Tests drive public runtime messages, alarms, context menus, and `runtime.onStartup`. They assert window/tab URL, title, discarded/frozen flags, session history, IndexedDB captures, and the persistent lil registry. Shared JSON fixtures are unchanged.

No new product seam. Harness additions are Chrome-boundary fakes: tab title / discarded / frozen, session history, and `chrome.scripting.executeScript` that actually runs `location.replace`.

## Red-green slices

Each slice: failing test first, then the minimum production change.

1. **Capture and registry before release.** Red on missing `originalTitle`. `sleepLil` now records original URL, original title, and capture identity, then releases the live document. Journal order: `captureVisibleTab` before the nap navigation.
2. **Nap document title.** Red on missing `t` query param. Nap URL carries the original title; `sleep.js` sets `document.title` to `💤 ` + that title. The fake applies the same title when the tab lands on `sleep.html`.
3. **History replace.** Red because `tabs.update` left `[original, nap]` in session history. Entry now `location.replace`s the nap URL (fallback: `tabs.update`). Session history becomes `[nap]`.
4. **Incognito exclusion.** Test written against existing guards: no capture, live URL unchanged, no registry entry.
5. **Restart restoration.** Red because restore omitted `originalTitle`. `restoreWindows` now reopens the nap document with capture key, original URL, and original title, and never live-loads the original page.
6. **Oracle vs discard/freeze.** One lil napped, one Chromium-discarded (`discarded: true`, original URL), one frozen (`frozen: true`, original URL). Lil Nap is nap URL + registry/capture + `discarded == false`. No `tabs.discard`.
7. **User-facing enter copy.** Red on context-menu title `Sleep this lil`. Menu, overlay caret item, nap page, and Settings resource-saving copy now use Lil Nap / Let This Lil Nap / Wake This Lil. Nap page copy is “Shhh… this lil is napping.” Card icon scaled to ~167% of the prior 108/96 px sizes (180/160).
8. **Automatic entry.** Sweep alarm uses the same `sleepLil` path; idle unfocused lil records the same capture/registry/title/history truth.

## Capture / registry / title / history / restart / oracle evidence

| Concern | Where | Observable |
|---|---|---|
| Capture | IndexedDB `lil-sleep` / `captures` | One blob keyed by `sleepCaptureKey`; `tabs.captureVisibleTab` before release |
| Registry | `ephemeralWindows` | `slept`, `originalUrl`, `originalTitle`, `sleepCaptureKey` |
| Title | tab + nap URL `t` | `💤 Example Docs` |
| History | harness session history | `[napUrl]` only; original URL gone |
| Document release | tab URL | `sleep.html?...`, not the original page |
| Incognito | message `sleepThisLil` | no capture, URL unchanged |
| Restart | `runtime.onStartup` | `windows.create` URL is `sleep.html`, not the original; title/registry restored |
| Oracle | three live tabs | Nap ≠ discard ≠ freeze as above |

## Changed files

- `extension/background.js` — record original title; replace history; restore nap URL with title
- `extension/manifest.json` — `scripting` permission for `location.replace`
- `extension/sleep.js` / `extension/sleep.html` — title, Shhh copy, Wake This Lil, card size
- `extension/overlay.js` — Let This Lil Nap
- `extension/test/chrome.js`, `harness.js`, `worker.test.js` — seam + tests
- `mac/Sources/LilChromiumApp/SettingsWindow.swift` — Lil Nap labels only
- `docs/PROTOCOL.md` — Lil Nap entry contract
- `.mayosdd/tickets/evidence/issue-20-enter-lil-nap/IMPLEMENTATION.md`

Internal registry keys (`slept`, `sleepCaptureKey`, `sleep.html`) kept so existing parked lils still restore. README / CHANGELOG left as Lucas’s prose.

## Commands and results

### Focused red-green

`node --test --test-name-pattern '…' extension/test/worker.test.js` for each slice above. Final green:

- entering Lil Nap captures…
- the napping document title…
- the nap document replaces rather than pollutes…
- incognito lils are never captured…
- a browser restart restores a napping lil…
- registry and capture state distinguish Lil Nap…
- the page context menu action is Let This Lil Nap
- automatic Lil Nap records the same capture…

### `pnpm test`

```
ℹ tests 45
ℹ pass 45
ℹ fail 0
```

### `swift test` in `mac/`

```
Test run with 141 tests in 13 suites passed after 0.107 seconds.
```

### `make app`

```
Done: mac/build/LilChromium.app
```

Worktree build only. Did not run `make install`, `make install-app`, `make install-host`, or `scripts/install-host.sh`. Did not reload the live app, browser, extension, or native host.

### `git diff --check`

Clean.

## Manual visual QA remaining

Real-browser, not run here:

- Nap page: “Shhh… this lil is napping.”, Wake This Lil hint, card optical weight (~67% larger), screenshot + tint
- Caret menu and page context menu: Let This Lil Nap
- Settings Lils copy: Let idle lils nap / Lil Nap after / Don’t nap…
- Click-to-wake still works; bounded 180–500 ms wake is issue #21
- Icon optical alignment subject to live eyeballing
