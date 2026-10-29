# Final standards review — issue #13 (`c2b692e...8bac542`)

Axis only: documented repo standards + Fowler ch.3 baseline (always judgement). Not spec.

**Verdict:** no new findings. No hard documented-standard breach. No baseline smell worth filing.

## Method

Read `AGENTS.md`, `docs/PROTOCOL.md`, `CONTEXT.md`, `docs/adr/0001`–`0003`, `docs/agents/domain.md`, and `git show main:.mayosdd/tickets/evidence/issue-13-palette-ranking/ledger.md` (D1, D2, interpretations 1–7). Walked `git diff c2b692e...8bac542` (commits `b513c17`…`8bac542`) and the post-fix sources at `8bac542`: `Ranking.swift`, `PaletteModel.swift`, `PaletteTests.swift`. Confirmed `PaletteController.applyAutocomplete` at `8bac542:429` is outside the delta. Skipped Swift 6 isolation (tooling). Did not re-run `swift test`.

## Documented standards — no hard breaches

1. **AGENTS.md — three-component contract.** Diff is `mac/` + `.mayosdd/` evidence. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. `docs/PROTOCOL.md` and `extension/` untouched — correct; Search-row promotion is palette row composition, not a contract change. Hover-bar “port the v0.2 palette ranking” still names the tier list this diff did not rewrite.
2. **AGENTS.md — `@MainActor` / `verified:`.** No new AppKit type. `PaletteModel` stays Foundation-only. No new OS claim; no `verified:` comment in the hunks to keep accurate.
3. **AGENTS.md — tests / prose.** Ordering cases land in `PaletteTests.swift` (`PaletteOrderingTests`). Shared fixtures stay at repo-root `fixtures/`. Lucas-facing copy untouched. Evidence is not product docs.
4. **PROTOCOL.md.** Search row still uses `searchEngine`. URL-like still Open then Search. Non-empty `capPerHost(..., perHost: 3)` unchanged.
5. **CONTEXT.md / domain.md.** No avoided synonyms (popup, default browser, connected browser, sleep, …) in the hunks.
6. **ADR 0001 / 0002 / 0003.** No Settings surface, no profile routing, no prior-context restore.

## Ledger (not re-filed)

- **J1** resolved — `registrableDomain`, `matchesRegistrableLabel`, `queryMatchesRegistrableLabel`.
- **J2** resolved — one helper, two call sites (origins and pages).
- **D1 / D2** — distinctive label only; approximate `registrableDomain` documented in code; no PSL.
- Interpretations 1–7 hold on this axis. Tests assert kinds / `actionURL` / host, never scoring constants.

## Baseline smells

None filed.

- **possible Feature Envy** — `PaletteModel.bestEligibleIndex` reads only `RankedResult` and `Ranking.isBefore`. Promotion is row composition; a Ranking API would be a new abstraction NA1 forbade. Ledger wins.
- **possible Duplicated Code** — `autocompleteHost` calls `rows(for:)`, which `PaletteController.reload` also calls. Owner: reuse that decision, no second ranking *policy*.
- Primitive Obsession on String hosts/domains: PROTOCOL and this tree use strings. Shotgun Surgery: one cluster (`Ranking` + `PaletteModel` + tests). `publicSecondLevelLabels`: D2, not Speculative Generality. `autocompleteHostValue` Middle Man: pre-existing, unchanged.

## needs adjudication

None.
