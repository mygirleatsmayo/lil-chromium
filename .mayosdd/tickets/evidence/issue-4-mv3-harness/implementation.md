# Issue #4 — MV3 worker harness

## What landed

A Node test suite that loads **production** `extension/background.js` in a `vm` sandbox against an in-memory fake Chrome / IndexedDB. Command: `pnpm test`. No browser, no live profile, no copy of the worker.

Seams (from the ticket + issue #2 testing decisions 3, 4, 14):

1. The real service worker, as Chromium would load it (top-level `connectNative` / `ensureSweepAlarm` included).
2. The public Chrome event/message/storage/native-messaging/tabs/windows/menus/alarms/IndexedDB boundary.
3. Observable window/tab mutations, the lil registry, and outgoing native-port messages.
4. Repo-root `fixtures/`, resolved from the test file the same way Swift uses `#filePath` — not `$HOME`, not cwd.

Production `extension/` is unchanged. The worker needed no harness branch; the fake is the seam.

## Criteria

| # | How |
|---|-----|
| 1 | `boot()` `vm.runInContext`s `extension/background.js`. Tests assert that path, not a fork. |
| 2 | `extension/test/chrome.js` + `indexeddb.js` cover the APIs the worker actually calls. |
| 3 | Tests assert create / URL update / focus / `tabs.move` / remove, registry contents, and host messages (`get-context`, `history-result`, `open-external`). |
| 4 | Same seven JSON files the native suite reads. Context / open / history / v1-defaults / v2-complete / unknown-fields meanings are asserted through the worker's public normalize + message handling. |
| 5 | No `if (harness)` (or equivalent) in production code. |
| 6 | In-memory fake only. One test chdirs to tmp and points `HOME` at a missing profile. |

## Out of scope

- Palette ranking, prior-context payloads, tint/reveal hot-apply, and the full issue #2 context-menu matrix (later tickets).
- Lil Nap vs Chromium discard/freeze oracle (issue #2 TD 9–11). Sleep is exercised only far enough to prove IndexedDB + `captureVisibleTab` are wired.
- `message-pong-legacy.json` has no extension-side decode (host/app). The suite still reads the file so the set is not forked.
- Unknown-field *preservation* is a config.json writer concern. The worker's `normalizeContext` drops keys it does not own; tests assert known fields still apply.
- PROTOCOL.md was not changed.

## Notes

- Wire `ephemeralDefault: "6h"` becomes the number `6` in the worker (`normalizeExpiry`). That is existing production behavior, not a fixture fork. Swift config decode keeps the string; each suite asserts its own public normalize against the same bytes (issue #2 TD 4).
- History fixture visit times are 2023. The worker searches a 90-day window, so the history test restamps `lastVisitTime` to now while keeping the fixture's URLs, titles, counts, and the sparse row with no fields.
- Fake Chrome awaits event listeners so tests are deterministic. Real Chromium does not wait; later tickets should not treat that as a timing guarantee.
