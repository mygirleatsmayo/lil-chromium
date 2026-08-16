# Remediation round 1 — Issue #11

Branch: `surfx/remediation-issue-11-fix-round-1-this-is-ylSNc4R1`
HEAD before this commit: `2803007`. Owner decision supersedes ledger interpretation 1: Lil Nap has no "no tint" choice; graphite is its neutral option. Hoverbar "no tint" is unchanged. `extension/` and `docs/PROTOCOL.md` were not touched.

## Ledger rows

| ID | Status | What changed |
|---|---|---|
| S1 = P1 | resolved | One `TintEditor` gained `offersNoTint` (default `true`). Lil Nap passes `false` and no longer shows a no-tint chip. `TintValue.sleepStorage(fromCommitted:)` no longer writes `""`; nil or empty commits graphite hex `#8e8e93`. Legacy empty/`"none"` sleep values display as that same chip. Hoverbar call site is unchanged (default still offers no-tint; nil still omits the key). Tests that pinned `""` (`sleepNoTintStorageIsEmptyNotDefaultPurple`, `sleepNoTintRoundTripsWithoutBecomingDefaultPurple`) are gone; replaced by graphite-hex storage and round-trip coverage. Draft/commit and hoverbar none/hex round trips kept. |

Criterion 2 listed "no tint" first for both editors. Dropping it from the Lil Nap call site is the owner-approved deviation; not restored, not filed as a problem.

## Lil Nap default is a real color

`TintPreset.graphite.hex` is `#8e8e93`. Confirmed by `TintTests`:

- `sleepNilOrEmptyCommitStoresGraphiteHex` — `sleepStorage(fromCommitted: nil)` and `sleepStorage(fromCommitted: "")` both equal `#8e8e93`, and that string is not empty.
- `sleepNilCommitRoundTripsAsGraphiteHex` — merged `config.json` has `sleep.tint` == `#8e8e93`, not `""`, not the PROTOCOL default `"purple"`. Decode then `committedHex(fromSleep:)` is graphite again.

That hex is a completed `#rrggbb`, so `extension/background.js` / `sleep.js` will not treat it as falsy and fall back to purple. Those files were not edited; the native write now matches what they already require.

## Verification

- `cd mac && swift build` — pass ("Build complete! (7.90 sec)").
- `cd mac && swift test` — pass: "Test run with 92 tests in 10 suites passed after 0.096 seconds." New tests `lilNapChoicesOmitNoTintAndKeepPresetOrder`, `sleepNilOrEmptyCommitStoresGraphiteHex`, `sleepNilCommitRoundTripsAsGraphiteHex` passed; existing draft/commit and hoverbar round-trip tests still passed.
- `pnpm test` from repo root — pass: 22/22.

Did not launch the app or open a window. Did not push, open a PR, or merge.
