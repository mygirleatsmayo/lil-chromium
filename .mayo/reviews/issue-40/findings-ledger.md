# Issue #40 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `1e09f76`

## Standards

- S1 · `PaletteResultsStackView` (new) and the edited `RowBackgroundView` / `PaletteRowView` lack `@MainActor` (AGENTS.md) · **fix**: annotate all three.
- S2 · `PaletteController.syncHoverToPointer()` walks the stack's layout, conversion and subviews (possible Feature Envy) · **fix**: the stack view answers "which row index is at this point"; the controller keeps the state updates.
- S3 · `currentPanelHeight()` re-clamps a row count `reload` already caps · **fix**: size from `currentRows.count`.
- S4 · `PaletteSelection: Equatable` and `private(set) var rowCount` have no external user · **fix**: drop what nothing uses (keep `Equatable` only if a test relies on it).

## Spec

- P1 · "The hover highlight always matches the row actually under the pointer" · **fix** · Settled: this includes a drag that starts in the search field and moves over the results.
- P2 · "A behavior test that runs without a window proves hover input cannot change the selection or the Return action" · **fix** · Settled: the test must go through the same model call the controller's Return handler uses (not an action the test builds itself), and include a rebuild that changes the query and rows under a parked pointer.
- P3 · Rendering split drops the favicon refresh that keyboard movement and modifier changes used to trigger · **fix** · Settled: hover stays reload-free, but favicon behavior must be no worse than at `bf45a2f`; a row built while its favicon is in flight must not keep the placeholder until the next rebuild. Amended after remediation 1: "no worse" means exactly that in-flight case. After a failed fetch, the retry comes on the next rebuild (typing) or reopen, not on ↑/↓ or modifier changes; retrying there was a side effect of the old full reload, and selection movement stays reload-free. Remediation 1's residual P3 report is **won't-fix** on this basis.

## Remediation 1

- N1 · `#expect(rows[1].kind == .search)` traps if the rebuilt list has one row · **fix**: require a second row before indexing so the test fails instead of trapping.

## Review status

- Full review 1: 4 Standards, 3 Spec. All marked fix.
- Remediation 1 (`4f52c0d...b5a33fc`): S1–S4, P1, P2 resolved; P3 residual adjudicated won't-fix (see P3); 1 new defect (N1, fix).
- Remediation 2 (`b5a33fc...27ebd4f`): N1 resolved, no new defects.
