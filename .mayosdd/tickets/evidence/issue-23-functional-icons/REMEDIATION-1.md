# Issue #23 — remediation round 1

Worktree: this Surfx checkout (`surfx/issue-23-remediation-round-1-frozen-ledg-7N1xAxvq`).
Reviewed implementation: `bb3740de5f8d506da074c21e5f24a48f3c54095d`. Ledger: `78ff4866318c898487104044278089862f15892f` (HEAD at start; unchanged in meaning).
Original fixed point: `411d47983443915c1fa67c77285471db309676d2`.
Live ticket: `gh issue view 23` — title, ACs, blockers #9/#19; 0 comments. Ledger S2 is the only code-review loop item in scope.

## Ledger rows

| ID | Status | What changed |
|---|---|---|
| S2 | resolved | Copy-reset assertion no longer sleeps 1.3s of wall time. Overlay harness exposes an opt-in manual clock at the existing `mountOverlay` seam; the test advances 1199ms (glyph still `check`) then 1ms (glyph `link`). Production `COPY_TICK_MS` is not exported. |
| S1 | won't fix (ledger) | Untouched. |
| P1 | deferred to #26 (ledger) | Untouched. |

## Changed files

- `extension/test/overlay.test.js` — clocked copy-reset; 1200ms production delay as an independent literal (1199 then 1).
- `extension/test/overlay-harness.js` — private `createClock()`; `mountOverlay({ clock: true })` swaps sandbox `setTimeout`/`clearTimeout`; default path still uses unref'd real timers.
- `.mayosdd/tickets/evidence/issue-23-functional-icons/REMEDIATION-1.md` — this file.

No Swift, overlay production, icon, PROTOCOL, or manifest edits.

## Red → green

Seam: overlay test ↔ `mountOverlay` (already the #23 overlay seam). Clock is a test-boundary timer, not a product hook.

| Slice | Red | Green |
| --- | --- | --- |
| Copy-reset via harness clock | `TypeError: Cannot read properties of undefined (reading 'advance')` at `page.clock.advance` (8.3ms) | 1 pass, 8.7ms |

## Commands and results

Focused overlay copy-reset (after green):

```
pnpm exec node --test --test-name-pattern 'Copy URL sits inside the address field' extension/test/overlay.test.js
```

1 pass, 0 fail (~9ms).

| Command | Result |
| --- | --- |
| Focused overlay tests (`extension/test/overlay.test.js`) | **11 pass, 0 fail** |
| `pnpm test` | **140 pass, 0 fail** |
| `swift test` (from `mac/`) | **163 pass, 0 fail** (16 suites) |
| `make app` (repo root) | **Build complete** → `mac/build/LilChromium.app` |
| `git diff --check` | clean |

Not run: `make install`, live app/browser/extension/native-host install or reload.

## Limitation

The test names the 1200ms production delay as a literal rather than importing `COPY_TICK_MS`. Changing the overlay constant without updating the test fails honestly; exporting the constant was out of ledger scope.
