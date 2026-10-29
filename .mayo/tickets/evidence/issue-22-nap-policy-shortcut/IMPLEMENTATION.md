# Issue #22 — Preserve Lil Nap policy and expose an optional shortcut

Branch: `surfx/implement-issue-22-preserve-lil-nap-poli-I2VBrynN`
Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2`
Scope: extension policy tests, unassigned `let-this-lil-nap` command, protocol lockstep. Wake (#21) and icons (#23) untouched. #20 truthful replacement/rollback and the Lil Nap oracle are unchanged.

## Agreed seam

Production MV3 service worker in Node (`extension/test/harness.js` loads `extension/background.js`) against the fake Chrome / IndexedDB boundary from issues #4 and #20.

Tests drive public runtime messages (`sleepThisLil`, `formDirty`), the `lil-sweep` alarm, `chrome.commands.onCommand`, and the unpacked `manifest.json` command table. They assert tab URL, registry nap fields, IndexedDB captures, and `tabs.captureVisibleTab` journal timestamps. Shared JSON fixtures are unchanged.

No new product seam. Harness additions: `env.command(name)` and a wall-clock `at` on each journal record so concurrent capture spacing is observable.

## Real-browser control seam (not simulated)

Deterministic tests use the Node harness: no live Chromium profile, no Memory Saver, no Drowzy. The oracle test still distinguishes three public tab states without naming an actor:

| State | URL | `discarded` | `frozen` | registry |
|---|---|---|---|---|
| Lil Nap | `sleep.html?…` | `false` | `false` | `slept` + capture key |
| Native discard | original page URL | `true` | `false` | no nap fields |
| Freeze | original page URL | `false` | `true` | no nap fields |

Flags are applied with `setTabState`. The suite never calls `tabs.discard` and never attributes a discarder.

Separate real-Mac controls (not run here): a disposable profile with Memory Saver off and Drowzy disabled for the deterministic cases; then enable each actor independently to confirm the same oracle. Drowzy cannot discard the active sole tab of a one-tab lil — that exact report is not attributed to Drowzy without contrary runtime evidence.

## Red-green slices

Each slice: failing test first, then the minimum production change. Policy slices were already implemented by #20 and went green immediately; the command and journal-timestamp slices went red first.

| Slice | Test | Production change |
|---|---|---|
| Auto off | automatic Lil Nap does not run when globally disabled | none (#20 `sleep.enabled`) |
| Threshold | waits until the configured idle threshold has passed | none (`afterMinutes`) |
| Focused / audible / dirty-form / whitelist / incognito | independently skipped | none (existing sweep guards) |
| Manual vs auto | manual works while auto is disabled; auto-only guards ignored; incognito still refused | none (`sleepLil` does not read `enabled`) |
| Command registration | unassigned `let-this-lil-nap`; `promote-tab` + overlay ⌘L/⌘O unchanged | `manifest.json` command, no `suggested_key` |
| Command dispatch | command naps the focused lil while auto is disabled | `commands.onCommand` → `sleepLil` |
| Concurrent capture | two overlapping `sleepThisLil` stay ≥500 ms apart | journal `at`; existing `throttledCapture` chain |

## Acceptance criteria → evidence

| AC | Evidence |
|---|---|
| Auto only when globally enabled and idle threshold passed | `automatic Lil Nap does not run when globally disabled…`; `automatic Lil Nap waits until the configured idle threshold…`; existing truthful auto-entry test |
| Focused, audible, dirty-form, whitelist, incognito skipped independently | one test each; other guards cleared so each skip is attributable to that guard |
| Manual available while auto is disabled except privacy/platform capture constraints | `manual Let This Lil Nap still works while automatic Nap is disabled`; `…ignores automatic-only guards but still refuses incognito capture`; #20 replacement-failure rollback tests unchanged |
| Standard command, no suggested default key | `the extension registers Let This Lil Nap as an unassigned command…` (`suggested_key` absent) |
| Existing commands and fixed editing/navigation keys unchanged | same test: `promote-tab` still suggests `Command+Shift+O` / `Ctrl+Shift+O`; overlay still captures ⌘L / ⌘O |
| Concurrent captures serialized within 2/sec via shared path | `concurrent Lil Nap captures serialize within two captures per second` (two `sleepThisLil` → two `captureVisibleTab` ≥500 ms apart, both napped) |
| MV3 tests for manual/auto, every guard, threshold, command, concurrency | `extension/test/worker.test.js` cases above |
| Deterministic tests disable Memory Saver/Drowzy; separate controls without actor attribution | Node harness + comment on the oracle test; this file’s control-seam table |

#20 truthful entry: replacement-only `replaceTabDocument`; failure rolls back nap fields and the fresh capture; `sleepThisLil` replies `{ ok: slept }`. Untouched.

## Changed files

- `extension/manifest.json` — `let-this-lil-nap` with description only
- `extension/background.js` — command dispatch through existing `sleepLil`
- `extension/test/harness.js` — `command()`
- `extension/test/chrome.js` — journal `at`
- `extension/test/worker.test.js` — policy, command, concurrency
- `docs/PROTOCOL.md` — unassigned command; manual while auto off; shared `throttledCapture`
- `.mayosdd/tickets/evidence/issue-22-nap-policy-shortcut/IMPLEMENTATION.md`

## Commands and results

| Command | Result |
|---|---|
| focused `node --test` during slices | policy green on existing #20 behavior; command/concurrency red, then green |
| `pnpm test` | 94 passed, 0 failed |
| `swift test` in `mac/` | 163 tests in 16 suites passed after 0.107 seconds |
| `make app` | `mac/build/LilChromium.app` built and ad-hoc signed |
| `git diff --check` | clean |

Worktree build only. Did not run `make install`, `make install-app`, `make install-host`, or `scripts/install-host.sh`. Did not reload the live app, browser, extension, or native host.

## Manual remaining

Real Chromium, not run here: assign `let-this-lil-nap` in `chrome://extensions/shortcuts` and confirm it is listed unassigned by default; confirm ⌘L / ⌘O still reveal/promote; Memory Saver / Drowzy control-seam above.
