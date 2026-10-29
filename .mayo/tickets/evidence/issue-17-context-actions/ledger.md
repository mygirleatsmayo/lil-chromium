# Findings ledger — issue #17 (truthful context actions)

Fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · Reviewed code: `d4ee5ba64ebb22d6c47bc1c5f6eb13bd6179b93f`.

Review round 1 (full, two-axis): Standards `1zKHDnVQ` (`cursor-grok-4.6-medium`), Spec `20_cxiW2` (`kimi-k3-max`).

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Findings

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| S1 | Standards | `CTX_SAME_LIL`, its internal menu ID, and same-lil log wording | **fix** | The action means “Open link in this lil”, not `linkBehavior: same-lil`. Use one unambiguous internal name throughout; this is not a public wire identifier. |
| P1 | Spec | Context-menu items are created visible before the first policy sync | **fix** | Every context-dependent item must begin hidden or be policy-synchronized before it can appear. Visibility and click authorization remain governed by the same policy; no transient lying labels after install/update/startup. |
| P2 | Spec | Context-menu incognito failure both broadcasts and queues a later mount hint | **fix** | Explain the current user action once. Context-menu failures target an already-mounted source page and must not leave a pending hint that replays after reload. Preserve the separate pending-hint behavior required by palette/caret fallback lils. |

## Round 1 outcome

Three focused fixes are owed. All other context, privacy, reparenting, capability-failure, lifecycle, focus, and protocol requirements passed.
