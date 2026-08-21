# Issue #23 — remediation review 1 (frozen ledger)

Pinned refs (all resolve; `HEAD` = remediation head):

- Original fixed point: `411d47983443915c1fa67c77285471db309676d2`
- Initial review head: `bb3740de5f8d506da074c21e5f24a48f3c54095d`
- Remediation base / ledger: `78ff4866318c898487104044278089862f15892f`
- Remediation head / `HEAD`: `0b6e620fc1d56426b7320fbfbad8477f7010ed1d`

Fix commit: `0b6e620` — `test(overlay): issue #23 remediation round 1 — deterministic copy-reset clock`

## S2 — resolved

Ledger: copy-reset waited 1.3s wall time, coupled indirectly to `COPY_TICK_MS`. Fix at the test boundary; do not export production internals or weaken the assertion.

Delta: `mountOverlay({ clock: true })` swaps sandbox `setTimeout`/`clearTimeout` for a private harness clock. The test advances 1199ms (glyph still `check`) then 1ms (glyph `link`). Production `COPY_TICK_MS` stays unexported (`extension/overlay.js` still `const COPY_TICK_MS = 1200`). The 1200ms duration appears as an independent test literal, matching ledger scope.

This is stronger than the old 1300ms sleep: a shorter reset would fail at 1199ms; a longer one would fail at 1200ms. No wall-clock wait.

S1 and P1 not reopened.

## New defects from the fix delta

None. Clock is opt-in; other overlay tests keep unref'd real timers. `setInterval` remains real; this test does not start the hoverbar poll. No production overlay/protocol change.

## Verification (read-only)

```
pnpm exec node --test --test-name-pattern 'Copy URL sits inside the address field' extension/test/overlay.test.js
```

1 pass, 0 fail (~13ms).
