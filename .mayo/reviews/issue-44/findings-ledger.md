# Issue #44 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `fe8fa9e`

## Standards

- S1 · Tab documentation is on the branch but not on `main` (AGENTS.md: docs land on `main` too) · **integration obligation, not code**: satisfied when the branch reaches `main`.
- S2 · `tabAction` repeats ⇧Return's query-to-search action construction (possible Duplicated Code) · **fix**: one shared builder; each shortcut keeps its own hint and empty-query behavior.
- S3 · Tab test repeats the ⇧Return test's setup and assertions (possible Duplicated Code) · **fix**: one parameterized test over both shortcuts, each with its expected hint.

## Spec

- No findings.

## Review status

- Full review 1: 3 Standards (S2, S3 fix; S1 integration), 0 Spec.
