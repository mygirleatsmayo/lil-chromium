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
