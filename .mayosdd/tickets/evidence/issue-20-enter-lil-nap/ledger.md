# Findings ledger — issue #20 (enter Lil Nap)

Fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · Reviewed code: `a6494a20a4350e9c372353f2013e0c87dff79a06`.

Review round 1 (full, two-axis): Standards `hY0jakDP` (`cursor-grok-4.6-medium`), Spec `XZDnusPD` (`kimi-k3-max`).

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Findings

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| S1 | Standards | `replaceTabDocument` falls back to `tabs.update`; `sleepLil` ignores replacement failure | **fix** | Successful Lil Nap entry requires history replacement. If replacement cannot be performed, leave the live document truthful, roll back nap registry/capture state, and report failure; never degrade to history-pushing navigation. |
| S2 | Standards | User-facing whitelist/Settings copy still says sleep/sleeping | **fix** | User-facing resource-saving copy uses Lil Nap/napping language, including whitelist actions and placeholders. Preserve compatible internal keys, IDs, filenames, and wire/config field names. Technical protocol prose should distinguish those legacy internal identifiers from user-visible terms. |
| S3 | Standards | `sleepPageUrl` carries one nap-state data clump as positional arguments and restore passes `undefined` tint | **fix** | Represent the nap-page inputs as one named value/object so capture identity, original URL/title, and tint cannot shift or be silently omitted across entry and restore. Keep the wire URL itself compatible. |
| P1 | Spec | Stale whitelist copy | **fix through S2** | Same settled copy requirement as S2. |
| P2 | Spec | History fallback and false nap state | **fix through S1** | Same truthful-entry and rollback requirement as S1. |
| P3 | Spec | Restart restoration drops configured tint | **fix through S3** | Restore must rebuild the nap page with the current configured `sleep.tint`; missing tint may use the existing default only when configuration itself supplies no tint. |

## Round 1 outcome

Three production fixes cover all six report entries. Capture/order, title, history on the successful path, incognito exclusion, restart without live-loading, oracle distinction, automatic entry, and the remaining requested copy passed.
