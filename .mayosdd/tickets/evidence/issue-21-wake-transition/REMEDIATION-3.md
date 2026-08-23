# Issue #21 — Remediation round 3

Branch: `surfx/issue-21-remediation-round-3-outcome-res-AqVWPHYP`
Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` · Pre-round-3: `1822b27`
Scope: exactly the one new **fix** finding in the frozen ledger (`P5`). A1 stays settled. Skill allowlist: `/mayosdd-tdd` only; red → green at the existing worker seam (production service worker under the fake Chrome/IndexedDB boundary).

## Ledger findings → resolutions

| ID | Resolution |
|---|---|
| P5 | The window-scoped `tabs.onUpdated` leftover-nap backstop now reconciles only when the **active**, user-visible tab has left the nap URL. An inactive same-window wake preload reporting the original URL is ignored: nap fields (`slept`, `sleepCaptureKey`, `originalUrl`, `originalTitle`) and the capture stay. P4 still holds: an active nap tab navigating off `sleep.html` still runs `clearNapState`. |

Settled items untouched: S1 helper, S2 private clock, P1 truthfulness/cleanup on healthy APIs, P2 no 500 ms page race, P3 listener-then-check, P4 bounded page wait + worker backstop for the visible document, S3 activation vs removal wording, 180 ms floor, 500 ms cap, A1's 1000 ms silent-worker recovery. Worker-owned preload/swap flow unchanged. No new protocol, message, abstraction, timer, or hung-API machinery.

Live issue #21 (no comments) matches the frozen ledger; no conflict.

## Focused red → green evidence

The new test failed against the pre-round-3 backstop for the stated reason, then passed after the production fix.

| Test | Red (pre-round-3) | Green (post-round-3) |
|---|---|---|
| `when an inactive same-window wake preload reports its original URL, nap state stays truthful` (P5) | After `tabs.create({ windowId, url: originalUrl, active: false })` plus a URL `onUpdated` on that inactive tab, `slept` was `undefined` and the capture was gone — the backstop keyed off `windowId` and treated any non-nap URL as leftover cleanup | Registry nap fields and capture remain; the nap document stays the active tab |

Focused command: `node --test --test-name-pattern 'inactive same-window wake preload' extension/test/worker.test.js`.

Related focused suite (P4 backstop + P1 failure paths + P5) stayed green:
`node --test --test-name-pattern 'leaves the nap document without a worker wake|inactive same-window wake preload|cannot activate the fresh document|nap tab cannot be removed|cannot navigate at all|wake preload is unavailable' extension/test/worker.test.js` — 6 pass.

## Full verification

- `pnpm test` — 133 tests, 133 pass, 0 fail (132 pre-round-3 + 1 new P5 worker backstop test). No wall-clock sleeps; worker tests use the existing Chrome fake.
- `swift test` (from `mac/`) — 163 tests in 16 suites passed.
- `make app` — worktree release build succeeded (`mac/build/LilChromium.app`). Run with `/bin` first in `PATH` (this shell's shadowed `rm` breaks the bundle script otherwise). No `make install` / install script run; the live app, browser, extension, and native host were never touched.
- `git diff --check` — clean.

## Changed files

- `extension/background.js` — napping `tabs.onUpdated` backstop requires `tab.active` before `clearNapState`.
- `extension/test/worker.test.js` — inactive same-window preload URL event must leave nap state truthful.
- `.mayosdd/tickets/evidence/issue-21-wake-transition/REMEDIATION-3.md` (this file).

PROTOCOL already said leftover state is reconciled “when the visible document leaves the nap URL”; no contract wording change.

## Real-Mac QA still required

Not run here (live environment untouched):

- Visible wake transition (180–500 ms image hold), unchanged.
- Worker wake with a real Chromium `tabs.create` → `onUpdated` URL on the inactive preload, while the nap image is still in front; nap state must remain until the active document actually replaces it.
- P4 page fallback on the visible nap tab still reconciles leftovers.
- A1: reopen only if a supported browser hangs a Chromium API promise across the 1000 ms silent-worker path.
