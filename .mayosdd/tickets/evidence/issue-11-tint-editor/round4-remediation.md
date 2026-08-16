# Remediation round 2 — Issue #11 (N1)

Branch: `surfx/remediation-issue-11-fix-round-2-scope-i-2dAnU_hJ`
HEAD before this commit: `633be7c`. Scope is N1 only. Round 1 not revisited. `extension/` and `docs/PROTOCOL.md` were not touched.

## Ledger row

| ID | Status | What changed |
|---|---|---|
| N1 | resolved | `TintValue.committedHex(fromSleep:)` returns `nil` for `""` and `"none"` (unusable, not graphite). Getter still coalesces that nil to graphite for the chip. Setter skip uses `sleepTintIfChanged` with **no** graphite fallback on `current`, so `nil != "#8e8e93"` and the write proceeds. PROTOCOL tokens `"purple"` / `"gray"` / `"grey"` still skip. Binding doc comment matches that. `TintEditor.writeCommitted()` always assigns so a displayed-graphite click reaches the setter. |

## Skip table (after)

| `sleep.tint` on disk | chip shown | click graphite | result |
|---|---|---|---|
| `""` or `"none"` | graphite | writes `#8e8e93` | **fixed** — `selectingGraphiteRewritesUnusableSleepTint` |
| `"gray"` / `"grey"` | graphite | no write | `selectingDisplayedSleepChipDoesNotRewriteUsableTint` |
| `"purple"` | purple | no write (click purple) | same test; named token still not rewritten |
| `#rrggbb` | that colour | no write when equal | same test (`#8e8e93`, `#3311aa`) |

`unusableSleepTintIsNotCommittedGraphite` pins `committedHex("")` / `committedHex("none")` as `nil`. `sleepStorage(fromCommitted:)` still stores graphite on a real nil/empty *commit*; that path never covered the skip.

## Why `writeCommitted` changed

The getter still returns graphite for unusable storage (required display). `TintEditor` used to skip `committed =` when getter hex already equalled the selected chip, so clicking graphite never reached the setter. Always assign; the binding setter is the skip.

## Verification

- `cd mac && swift build` — pass ("Build complete! (8.38 sec)").
- `cd mac && swift test` — pass: "Test run with 95 tests in 10 suites passed after 0.093 seconds." New tests `unusableSleepTintIsNotCommittedGraphite`, `selectingGraphiteRewritesUnusableSleepTint`, `selectingDisplayedSleepChipDoesNotRewriteUsableTint` passed; named-token, storage, and round-trip tests still passed.
- `pnpm test` from repo root — pass: 22/22.

Did not launch the app or open a window. Did not push, open a PR, or merge.
