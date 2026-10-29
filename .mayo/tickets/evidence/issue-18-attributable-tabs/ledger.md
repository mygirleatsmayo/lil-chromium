# Findings ledger — issue #18 (attributable new tabs)

Fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · Reviewed code: `27dea746664c8c9f0139c4e309cf8d8e321390e7`.

Review round 1 (full, two-axis): Standards `C4joNo-e`, Spec `eTmPJVXX`, both `cursor-grok-4.6-medium`.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Findings

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| S1 | Standards | `tabs.onCreated` can act before `onCreatedNavigationTarget` claims an opener-less/OAuth target | **fix** | A tab claimed by the existing new-window link flow must never be converted by issue #18. Preserve missing-opener and OAuth leave-alone rules without timing-proximity attribution. Exercise the public event-order race. |
| S2 | Standards | `docs/PROTOCOL.md` omits issue #18 conversion semantics | **fix** | Document the public-event attribution rule, positive conversion, and safe non-conversion. This remains an extension-only behavior change; it does not require an app/host wire change. |
| S3 | Standards | `lastNormalWindowId` resembles the forbidden restore MRU and is not cleared | **won't-fix** | It is destination-attribution state, not a predecessor fallback. A stale ID produces safe non-conversion, and Chromium window IDs are not a durable restore identity. Rename only if a required fix makes the distinction unclear. |
| P1 | Spec | Claimed `tabs.onCreated` `windowId === -1` attach race | **won't-fix; unsupported premise** | Chrome's public `Tab.windowId` is required and identifies the containing window; `onCreated` documents unsettled URL/group state, not an unattached or missing window ID. Do not invent a fake unsupported event. Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab |
| P2 | Spec | Event-order coverage omits delayed link ownership | **fix through S1** | Add a real public-event ordering case where `tabs.onCreated` precedes `onCreatedNavigationTarget`; do not add an unsupported `windowId === -1` case. |

## Round 1 outcome

Two production/documentation fixes plus one focused race test are owed. The unsupported destination-window premise and the restore-MRU analogy are settled without code changes.
