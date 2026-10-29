# Remediation round 2 — issue #9

Branch: `surfx/remediate-issue-9-round-2-outcome-resolv-_AxCuxHM`
Original fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558`
Frozen ledger / pre-fix: `4dcf3929c2ec56bf6f4fb7c7b6b2f3c4ad245eba`

Final full review round 1 findings: S1 **fix**, P2 **fix through S1**. Ledger and review reports untouched. Production code and tests untouched.

## S1 — PROTOCOL matches complete-word Settings queries

Settled: update the contract sentence to the already-settled P1 behavior: only the complete case-insensitive words `settings` and `preferences` match. Production and tests are already correct.

### Diff

`docs/PROTOCOL.md` palette bullet: the parenthetical no longer says queries that prefix those words. It now says the selectable Settings result is the complete case-insensitive words “settings” and “preferences” only. Gear + Settings still close the palette then present Settings and never send `open`.

No other PROTOCOL sentences changed. No `mac/`, `extension/`, or test edits.

### Tests (TDD)

Seam already covered by `PaletteSettingsAccessTests` (`PaletteModel.rows`). No new tests: this round is prose-only.

Existing cases already lock S1/P1: full-word case variants lead with Settings; stubs `set` / `sett` / `pref` / `prefer` stay Search-first with no Settings row.

## P2 — duplicate of S1

Settled: **fix through S1**; no additional product behavior change. Resolved by the same PROTOCOL sentence.

## Verification

| Command | Result |
|---|---|
| `swift test --filter PaletteSettingsAccessTests` in `mac/` | 4 tests / 16 cases passed |
| `git diff --check` | clean |

Live app / browser / extension / native host were not installed, launched, reloaded, or quit.
