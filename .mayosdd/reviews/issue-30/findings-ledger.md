# Issue #30 findings ledger

Original fixed point: `8753d0c`
Initial reviewed point: `e624c3d`

## Standards

- S1 · `lil-focus-trace` control can mutate windows but is absent from the three-component contract · **fix**: make the retained diagnostic control seam comply with the `AGENTS.md`/`docs/PROTOCOL.md` rule across extension, native relay, and protocol documentation; preserve its explicitly diagnostic/private status.
- S2 · diagnostic arm accepts any collector endpoint while the extension has broad fetch permission · **fix**: accept only a run-scoped loopback collector endpoint and fail closed otherwise.
- S3 · diagnostic close accepts an arbitrary window id · **fix**: allow teardown only for a currently registered lil owned by the armed run; a wrong, stale, or Primary id must be inert and tested.
- S4 · `focus-trace.js` both traces and handles diagnostic lifecycle/teardown · **won't-fix**: once S1–S3 are resolved, those responsibilities form one bounded diagnostic lifecycle module rather than unrelated product behavior.
- S5 · verdict aggregation duplicated between run and replay · **fix**: share the fold so live and replay cannot drift.
- S6 · LILFOCUS edits span extension, host, probe, and CLI · **won't-fix**: cross-component observability is required by #30; the unique tag and one cleanup grep are the deliberate gathering seam.
- S7 · `scripts/focus-loop.mjs` owns CLI, collector, relay, probing, arrangements, and artifacts · **fix**: deepen the existing modules at natural seams and reduce the main file's divergent responsibilities without speculative abstraction or increased overall complexity.
- S8 · arm/disarm/snapshot/close are optional primitive fields on one control type · **fix**: use one explicit tagged operation plus the minimum operation-specific payload; keep the contract simple and validate it.
- S9 · issue-linked Swift probe tests omit Swift Testing bug metadata · **fix**: add the repo-consistent issue #30 bug association.

## Spec

- P1 · live artifact is inconclusive rather than reproducing the current symptoms red · **verification obligation, not a remediation-code finding**: keep #30 open until the integrated command runs the full matrix on the current trial and reports the observed regressions red.
- P2 · live artifact lacks extension-selected context, focus events, restore target, and exact relay fields because the live seam was absent · **verification obligation, not a remediation-code finding**: the integrated red run must contain every structured identity/event required by #30.
- P3 · open verdict can report green when the requested lil lands on the wrong display · **fix**: require the requested lil to land on the source application's display and remain the focused requested window while independently detecting any risen Helium sibling; cover the false-green live arrangement with focused tests.
- P4 · unfocused-red-button prompt asks the operator to return, adding a focus-changing action before capture · **fix**: that scenario's only human gesture is the red-button click; detect completion and capture/verdict automatically without Enter, refocus, or another click.
- M1 · seam-absent run opened a lil it could not tear down, poisoned later arrangements, and left CG window `45553` open · **fix**: preflight must fail before mutation when safe teardown/control is unavailable; no run may leave an unowned diagnostic lil behind.

## Manager review note

The required first `surfx output --diff` was truncated because the diagnostic change is large. A second restricted inspection of code structure and sanitized trace fields was necessary before acceptance. The retained trace contains app/window identity and geometry needed by the z-order oracle, but no window titles, URLs, or document content.

## Settled remediation interpretation

P4 applies to every close gesture performed while a measurement is in flight, not only `close/unfocused-red-button`: returning to a terminal or pressing Enter can overwrite the observed frontmost application in all three close scenarios. Arrangement setup may still require Enter because no measurement is then in flight.

## First remediation review

S1–S3, S5, S7–S9, P3–P4, and M1 resolved. No regression of S4/S6; P1/P2 remain verification obligations.

- M2 · `focusTraceRemoveOwnedLil` drops ownership before `chrome.windows.remove` succeeds · **fix**: retain ownership after `close-failed` so the final sweep can retry; forget the id only after confirmed removal or a truthful terminal stale/not-lil outcome.
- M3 · live teardown failure adds an inconclusive result that replay cannot reconstruct from the trace · **fix**: durably record the repetition/outcome through the same replay contract so live and replay fold identically, including teardown failure.

## Second remediation review

M2 and M3 resolved in `d02925e`. No new defects. P1/P2 remain live verification obligations, not code-review failures.
