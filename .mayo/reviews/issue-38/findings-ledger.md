# Issue #38 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `6cfdb52`

## Standards

- S1 · `isShowingCompletion` is true only while the controller writes the completion (possible Mysterious Name) · **fix**: rename (e.g. `isApplyingCompletion`).
- S2 · `PaletteModel` builds `Ranking.RankedResult(score: origin.frecency, matchesRegistrableLabel: false, …)` itself (possible Feature Envy) · **fix**: one origin → result conversion owned by `Ranking`, shared with the frecency listing.
- S3 · The new `action(for: PaletteInput, …)` overload only forwards `input.typed` (possible Middle Man) · **fix**: keep one action entry point.
- S4 · `@discardableResult` on `selectionDidChange`, whose result every caller checks · **fix**: remove it.

## Spec

- P1 · "Accepting the completion without changing the text (→, ⌘→, End, or a click that drops the selection)" · **fix** · Settled: End reaches the field as `scrollToEndOfDocument:` and leaves the selection, so it must be handled to accept the completion. Each listed key must accept as the real field sends it.
- P2 · Type `github.c`, ↓, Return: field shows `github.com` but Return opens `https://github.c` · **needs adjudication (Lucas)**. Not sent for fixing until decided.
- P3 · Dedupe strips query strings and drops the Search row (`https://duckduckgo.com/?q=duck`) when `duckduckgo.com` is the completion · **fix** · Settled: "without repeating the top row" removes only a row that opens the same destination as the top row. The Search row is never removed.
- P4 · Tests bypass P1 (pre-collapsed End selection), always Return on row 0, and the row-order fixture has no remaining history · **fix**: drive keys as the field sends them, Return through the selected row, and include remaining matching history in the fixture.

## Remediation 1

- N1 · `isSameDestination` treats `https://example.com:8443/` and `https://example.com/` as the same page: `normalizeURLKey` drops the port and only the query is added back · **fix** · Settled (P3): "same destination" keeps the dedupe key's trivial differences (case, scheme, `www.`, trailing slash); a different port or query is a different page.
- N2 · The fix delta deletes `selectionThatStillShowsTheCompletionChangesNothing`, dropping the check that a selection still covering the completion leaves it pending · **fix**: restore that coverage through the stand-in field.

## Review status

- Full review 1: 4 Standards (all fix), 4 Spec (P1, P3, P4 fix; P2 pending Lucas).
- Remediation 1 (`766c358...3b0ef21`): S1–S4, P1, P3, P4 resolved; 2 new defects (N1, N2 fix); P2 still pending Lucas.
