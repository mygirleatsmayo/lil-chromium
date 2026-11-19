# Issue #44 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `fe8fa9e`

## Standards

- S1 · Tab documentation is on the branch but not on `main` (AGENTS.md: docs land on `main` too) · **integration obligation, not code**: satisfied when the branch reaches `main`.
- S2 · `tabAction` repeats ⇧Return's query-to-search action construction (possible Duplicated Code) · **fix**: one shared builder; each shortcut keeps its own hint and empty-query behavior.
- S3 · Tab test repeats the ⇧Return test's setup and assertions (possible Duplicated Code) · **fix**: one parameterized test over both shortcuts, each with its expected hint.

## Spec

- No findings.

## Final review 1

### Standards

- S1 (again) · Docs and ledger still branch-only · **integration obligation**, as above.
- S4 · AGENTS.md: "Mark API/OS behavior you have confirmed on a real system with a `verified:` comment". The reviewer's macOS 27.0.1 probe confirmed plain Tab reaches the field as `insertTab:` and consuming it keeps the field editor focused, and that hiding the hint returns its space to the field; neither hunk carries `verified:` · **fix**: confirm both on this Mac and mark them `verified:` at the Tab handler and the hint layout.
- S5 · The ⇧⌘Return test repeats the parameterized forced-search test's setup and `.search` assertion (possible Duplicated Code) · **fix**: one parameterized test over ⇧Return, ⇧⌘Return and Tab, each case with its hint and incognito flag.

### Spec

- No findings.

## Review status

- Full review 1: 3 Standards (S2, S3 fix; S1 integration), 0 Spec.
- Remediation 1 (`fe8fa9e...1590a93`): S2, S3 resolved, no new defects.
- Final review 1 (`bf45a2f...2767966`): Standards S4, S5 fix (S1 integration); Spec none.
