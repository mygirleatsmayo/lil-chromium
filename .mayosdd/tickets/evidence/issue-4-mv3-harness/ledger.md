# Findings ledger — Issue #4: Exercise the real MV3 worker in Node

Branch `v0.4/issue-4-mv3-harness`. Fixed point `main` @ `4a4ada8`. Code at `59302ae`.

Round 1 review: Standards `3BhE_TO8`, Spec `6ZMvGYWk`. Both returned **No findings**.

## Findings

None.

## Manager verification

Both reports were terse, so the criteria most open to faking were checked directly:

| Criterion | Check | Result |
|---|---|---|
| 1 — real production worker | `harness.js:8,87` — `WORKER_PATH` resolves to `extension/background.js`; `vm.runInContext(fs.readFileSync(WORKER_PATH))` | met; the shipped file is executed verbatim |
| 2 — fake Chrome coverage | `chrome.js` namespaces: runtime, tabs, windows, storage, contextMenus, alarms, history, webNavigation, commands; `connectNative` present; IndexedDB in `indexeddb.js` | met |
| 4 — shared fixtures | `fixture.js:12` resolves repo-root `fixtures/` from `import.meta.url`, never `$HOME` — mirrors the Swift `#filePath` approach | met; one set of bytes for both suites |
| 5 — no test-only production branches | grep for `process.env` / `NODE_ENV` / `__TEST` / `isTest` across `extension/*.js` | no matches |
| 6 — repeatable, no browser | `pnpm test` run from a clean checkout | 22 tests pass |

## Settled interpretations

1. `AGENTS.md` was edited to document `pnpm test`. Standards review raised no finding; the edit adds the new command and does not rewrite Lucas's prose. Flagged to Lucas for awareness.
2. Node's built-in test runner with zero new dependencies is the accepted harness. `pnpm-lock.yaml` gained 9 lines.

## Verdict

Ledger empty at round 1. No remediation round required.
