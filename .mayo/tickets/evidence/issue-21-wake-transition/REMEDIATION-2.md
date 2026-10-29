# Issue #21 — Remediation round 2

Branch: `surfx/issue-21-remediation-round-2-outcome-res-84yh7ZMi`
Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` · Pre-round-2: `1593a59fe3a57cdbeabd88a112a28ab15af5cec3`
Scope: exactly the two new **fix** findings in the amended frozen ledger (`P4`, `S3`). A1 stays settled. Skill allowlist: `/mayosdd-tdd` only; red → green at the existing page/worker seams (production nap page under the sleep-page harness; production service worker under the fake Chrome/IndexedDB boundary).

## Ledger findings → resolutions

| ID | Resolution |
|---|---|
| P4 | The nap page still starts registry + capture reconciliation on fallback, but `leaveNap` races that work against a one-turn timer bound (`CLEANUP_BOUND_MS = 0`) and navigates when either side wins. A hung `storage.local` / IndexedDB call can no longer hold the nap document. Cleanup that does finish after the bound still applies. Leftovers the page could not finish are reconciled on the worker's existing `tabs.onUpdated` registry-upkeep listener: a napping lil whose visible URL has left `sleep.html` runs `clearNapState` (lil stays registered, nap fields cleared, capture deleted). Navigating *to* the nap URL during entry does not clear. |
| S3 | PROTOCOL now states the two failure paths separately: activation failure drops the preload and leaves the already-visible nap document in front; removal failure reactivates the nap document and drops the preload. No worker behavior change. |

Settled items untouched: S1 helper, S2 private clock, P1 truthfulness/cleanup on healthy APIs, P2 no 500 ms page race, P3 listener-then-check, 180 ms floor, 500 ms cap, A1's 1000 ms silent-worker recovery.

## Focused red → green evidence

Each new test failed against the pre-round-2 code for the stated reason, then passed after its production fix.

| Test | Red (pre-round-2) | Green (post-round-2) |
|---|---|---|
| `a hung storage API does not strand the nap document: the page navigates after a bounded wait` (P4 page bound) | After firing every timer shorter than the 1000 ms unreachability backstop, `navigatedTo` stayed `null` — `leaveNap` was still awaiting hung `storage.local.get` | Bound timer lets `location.replace` run; nap fields and capture remain for the worker backstop |
| `when a napping lil leaves the nap document without a worker wake, leftover nap state is still reconciled` (P4 worker backstop) | `slept` stayed `true` and the capture remained — `onUpdated` returned early for napping lils | Registry nap fields cleared, `url` restored, capture deleted; lil still registered |

Focused commands: `node --test --test-name-pattern 'hung storage API' extension/test/sleep-page.test.js` and `node --test --test-name-pattern 'leaves the nap document without a worker wake' extension/test/worker.test.js`.

## Full verification

- `pnpm test` — 132 tests, 132 pass, 0 fail (130 pre-round-2 + 2 new: 1 page bound, 1 worker backstop). No wall-clock sleeps; page tests fire captured timers; worker tests use the existing Chrome fake.
- `swift test` (from `mac/`) — 163 tests in 16 suites passed.
- `make app` — worktree release build succeeded (`mac/build/LilChromium.app`). Run with `/bin` first in `PATH` (this shell's shadowed `rm` breaks the bundle script otherwise). No `make install` / install script run; the live app, browser, extension, and native host were never touched.
- `git diff --check` — clean.

## Changed files

- `extension/sleep.js` — bounded `leaveNap` wait before `location.replace`; cleanup continues if it later settles.
- `extension/background.js` — `isSleepPageUrl`; napping `tabs.onUpdated` URL-upkeep backstop calls `clearNapState` when the document has left the nap URL.
- `extension/test/sleep-page-harness.js` — optional never-settling `storage.local.get`.
- `extension/test/sleep-page.test.js` — hung-storage bounded-departure test.
- `extension/test/worker.test.js` — event-driven leftover-nap-state test.
- `docs/PROTOCOL.md` — P4 bounded fallback + worker backstop; S3 activation vs removal wording.
- `.mayosdd/tickets/evidence/issue-21-wake-transition/REMEDIATION-2.md` (this file).

## Real-Mac QA still required

Not run here (live environment untouched):

- Visible wake transition (180–500 ms image hold), unchanged.
- Nap-page fallback when cleanup APIs are healthy (registry/capture cleanup before or shortly after navigate).
- Worker backstop is covered by the `tabs.onUpdated` fake; worth observing only if a real hung `storage.local` / IndexedDB call is seen, to confirm the page still leaves and the next URL change clears leftovers.
- A1: reopen only if a supported browser hangs a Chromium API promise across the 1000 ms silent-worker path.
