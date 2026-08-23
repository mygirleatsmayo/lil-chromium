# Findings ledger — issue #7 (route through Primary and Fallback installations)

Fixed point: `release/v0.4` (`ea58b515357bda113e3dd3b8738d4cd9fef09c93`) · Branch: `v0.4/issue-7-primary-fallback` · Reviewed code: `ddb624741edcc9a09474f0b724b751f308bfc848`.

Review round 1 (full, two-axis): Standards `nTnwx-0N`, Spec `cnSL0cEs`, both `cursor-grok-4.6-xhigh`.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Manager verification

The Spec axis returned no findings across all acceptance criteria. I independently confirmed both Standards findings in the review target:

- `extension/overlay.js` sends `"primary"` from the new caret action but still sends `"default"` from the hoverbar button and Command+O path. Behavior currently falls through to Primary, but the stale token violates the canonical domain vocabulary and creates divergent representations for one action.
- The new Fallback warning icon supplies only visual color and `.help`; it does not expose the warning meaning as an accessibility label.

## Findings

| ID | Location | Verdict | Reasoning |
|---|---|---|---|
| S1 | `extension/overlay.js` hoverbar button and Command+O still call `promote("default")` | **fix** | One Primary action should use the canonical `"primary"` destination everywhere. This is a surgical token correction; routing behavior must remain unchanged. |
| S2 | `SettingsWindow.swift` new Fallback warning `Image` has no accessibility label | **fix** | Preserve the visual/help treatment and expose the warning meaning to VoiceOver. Do not refactor the pre-existing Primary picker in this ticket. |
| P1–Pn | — | none | Spec axis found the implementation complete and in scope against issue #7, parent #2, the issue #6 ledger, `CONTEXT.md`, and `docs/PROTOCOL.md`. |

## Settled interpretations

1. `"primary"` is the canonical internal destination token for promote-to-Primary actions; `"default"` is legacy vocabulary and must not be introduced or retained by this diff's edited action paths.
2. S1 changes vocabulary only. The hoverbar button, Command+O, and caret action must retain identical promote-to-Primary behavior.
3. S2 is confined to the newly added Fallback warning. The pre-existing Primary warning is outside issue #7's diff and is not owed by this remediation.
4. Issue #27 is a separate owner product decision. This ledger reviews issue #7 against its current canonical specification and does not settle whether Fallback remains in v0.4.

## Round 1 outcome

Two focused fixes are owed. No owner adjudication is required before remediation.

## Remediation round 1 review

Review task `dEID59h8` (`cursor-grok-4.6-xhigh`) checked only the frozen ledger and fix delta `ddb62474...ac5daa11`.

- S1: resolved
- S2: resolved
- New defects: none
- Needs adjudication: none

All ledger fixes are resolved. Proceed to the required final full two-axis review with these settled interpretations attached.

## Final full review

Final Standards task `gF6RpqLp` and Spec task `vs020HlW`, both `cursor-grok-4.6-xhigh`, reviewed `ea58b515...d707f9a6` with this ledger attached.

- Standards: no new findings, no ledger regressions, no adjudication needed
- Spec: no new findings, no ledger regressions, no adjudication needed

The code-review loop is complete. Final manager verification, the separate issue #27 product decision, and explicit owner merge approval remain.
