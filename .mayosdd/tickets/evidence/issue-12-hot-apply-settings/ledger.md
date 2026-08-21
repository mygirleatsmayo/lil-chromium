# Findings ledger — issue #12 (hot-apply global settings)

Fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · Reviewed code: `9423784f1c4a666dd68618f9e894de5b43b9f4e5`.

Review round 1 (full, two-axis): Standards `cnENV3eK`, Spec `x15-0tMy`, both `cursor-grok-4.6-xhigh`.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Findings

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| S1 | Standards | `docs/PROTOCOL.md`: “all connected browsers and lils” | **fix** | Use the domain terms “live relays” and “lils”; “connected browser” is explicitly avoided by `CONTEXT.md`. |
| S2 | Standards | `lilchromium-host/main.swift`: `handleGetContext` duplicates `ContextPayload` browser/name mapping | **fix** | `ContextPayload` is the single normalization path for both `context` and `config-update`; reconnect and hot-update payloads must not drift. |
| S3 | Standards | `SettingsWindow.swift`: reveal-zone slider value presentation | **fix** | Preserve the visible pixel value without a rigid caption width and expose the current pixel value to accessibility. Do not redesign the Settings layout. |

## Spec axis

No findings. Hot-apply fanout, future-lil seeding, reconnect catch-up, reveal-zone behavior, unknown-field preservation, and three-component lockstep passed.

## Round 1 outcome

Three small Standards fixes are owed. No Spec fix or owner adjudication is required before remediation.

## Remediation round 1

Remediation commit `3caaf61a6b54d73dd57d7dbeff70d727c2472aef`; review `q_Ziw93V` (`cursor-grok-4.6-medium`). S1, S2, and S3 are resolved. The fix delta introduced no regressions, new defects, or unsettled interpretations. Proceed to the final full two-axis review.
