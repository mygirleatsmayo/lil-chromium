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

## Final review 1

### Standards

- S5 · Edited `FaviconCache` creates `NSImage`s and holds main-thread state without `@MainActor` (AGENTS.md: annotate AppKit-touching classes) · **fix**: annotate it; keep the main-thread hops compiling under the Swift 6.4 toolchain.
- S6 · Edited `PalettePanel` lacks the explicit `@MainActor` (AGENTS.md) · **fix**: annotate it, as S1 did for the edited views.
- S7 · `clickRow` calls `selection.click(idx)`, which ignores an out-of-range index, then `activateSelection()` opens the previously selected row; `bf45a2f` returned early · **fix**: an invalid click opens nothing.
- S8 · Favicon coalescing (several rows waiting on one fetch) has no runnable check (global rules: non-trivial logic leaves one runnable check) · **fix**: same as question K to Lucas (a fake-fetch seam plus one focused test: a caller joining an in-flight fetch gets the image, and only one fetch runs). Acted on as yes under Lucas's test rule; reverted if he answers no.
- S9 · `Array(model.rows(for: query).prefix(maxResultRows))` repeats the model's row cap (possible Duplicated Code) · **won't-fix**: the controller cap predates #40 (`bf45a2f` had `currentRows.prefix(maxResultRows)`); #43 (max results setting) owns where the limit lives.
- S10 · `refreshHighlights()` walks `stack.arrangedSubviews.enumerated()` (possible Feature Envy) · **won't-fix**: that loop predates #40; #40 only changed what each row is told.

### Spec

- P4 · "The hover highlight always matches the row actually under the pointer": a drag that starts in another window does not update hover until release · **won't-fix** · Settled: hover follows pointer events the palette receives: moves over it and drags that start in it (P1). A drag owned by another window is not hover.
- P5 · Same line: at a shared row edge, `frame.contains` picks the upper row while AppKit's hit test (and so a click) picks the lower one; at the list's bottom edge hover keeps the last row while a click hits none · **fix** · Settled: hover uses the same hit rule as a click, so the hovered row is always the row a click there would open, and no row at a point a click would miss.

## Review status

- Full review 1: 4 Standards, 3 Spec. All marked fix.
- Remediation 1 (`4f52c0d...b5a33fc`): S1–S4, P1, P2 resolved; P3 residual adjudicated won't-fix (see P3); 1 new defect (N1, fix).
- Remediation 2 (`b5a33fc...27ebd4f`): N1 resolved, no new defects.
- Final review 1 (`bf45a2f...033ae4a`): Standards S5–S8 fix, S9, S10 won't-fix; Spec P5 fix, P4 settled won't-fix.
