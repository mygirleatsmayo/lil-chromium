# Findings ledger — issue #15 (restore each lil's prior context)

Fixed point: `release/v0.4` (`ea58b515357bda113e3dd3b8738d4cd9fef09c93`) · Branch: `v0.4/issue-15-prior-context` · Reviewed code: `a236e3a20f93830c39e3bea30d1c2c2e60874058`.

Review round 1 (full, two-axis): Standards `OwcQscM1`, Spec `YMhnNIs5`, both `cursor-grok-4.6-xhigh`.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Manager verification

- The promote finding is concrete: `moveTabIntoHostBrowser` moves the sole tab before deregistering its lil window; the production MV3 harness closes that empty window and fires `onRemoved`, so the new prior-context handler can restore a predecessor before the intended host target is focused.
- The naming finding is real but low risk: the app wire field `priorContext` becomes `externalContext` inside `openLil`, even though both represent the same domain concept and the latter name can be confused with the `.externalApp` variant.
- The Standards report's macOS event-order premise is not established. Chrome's official API reference says `WINDOW_ID_NONE` means no Chrome window has focus and gives an immediate pre-switch caveat only for some Linux window managers; it does not specify macOS close ordering. The ticket already reserves macOS app switching for focused real-Mac QA.
- The external-process fallback exists in `ExternalAppRestorer`: exact PID first, same-bundle running application second, otherwise no-op. The MV3 worker cannot observe whether a native PID is dead, while native message fixtures and round-trip tests cover the cross-component payload.

Primary source: https://developer.chrome.com/docs/extensions/reference/api/windows#event-onFocusChanged

## Findings

| ID | Location | Verdict | Reasoning |
|---|---|---|---|
| S1 | `background.js` focus tracking plus `onRemoved`; fake `windows.remove` omits `onFocusChanged` | **won't-fix pending real-Mac QA** | The claimed macOS event order is unverified and not guaranteed by the API. Do not add speculative timing/state logic. Reopen only if focused release QA reproduces a missed restoration. |
| S2 | `openLil` uses `priorContext` and `externalContext` for the same domain concept | **fix** | Rename the app-supplied candidate to make its source/gating role explicit without changing behavior or the public wire field. |
| P1 | `moveTabIntoHostBrowser` deregisters only after moving the sole tab closes its lil window | **fix** | Promotion is a lifecycle transfer, not a close/unwind. Suppress predecessor restoration during a successful promote while preserving registry state on failed promotion attempts. Add a public MV3-harness assertion that promotion emits no focus restoration. |
| P2 | No automated test kills a native PID and exercises AppKit bundle fallback | **won't-fix; manual seam** | Native PID liveness/activation is AppKit real-system behavior covered by the parent spec's focused real-Mac app-switching QA. Do not create a new injectable AppKit seam or a meaningless MV3 “dead PID” test. Existing fixtures/tests cover the protocol payload. |

## Settled interpretations

1. `WINDOW_ID_NONE` remains meaningful external-focus state. No timing heuristic or “ignore NONE” workaround is permitted without reproduced macOS event evidence.
2. Closing a focused lil unwinds prior context; promoting a lil into a host target does not. A failed promotion must leave the lil registered and eligible for normal close behavior.
3. The public and domain term remains `priorContext`. An internal name may distinguish an app-supplied candidate, but must not suggest a second concept or change the wire contract.
4. Exact-PID death and bundle-ID fallback activation remain mandatory focused real-Mac QA. Automated coverage stays at the agreed native contract/message and production MV3 seams.
5. Inherited issue #5 interpretations remain final: unfocused restoration stays unfocused; the duplicate URL guard and API `type: "popup"` stay; issue #15 may supersede the previously out-of-scope dead `prev` merge only where its own implementation requires it.

## Round 1 outcome

Two fixes are owed (S2, P1). Two findings are settled without code changes (S1, P2). No owner adjudication is required before remediation.

## Final-review adjudication

| ID | Location | Verdict | Reasoning |
|---|---|---|---|
| NA1 | Caret action `reopenIncognito` replaces a source lil without carrying its recorded predecessor into the successor | **won't-fix; defer** | This is a non-blocking edge case outside the ticket's settled transfer behavior. The owner chose not to spend another remediation and full-review cycle on it now. Revisit as separately scoped work if incognito-reopen continuity becomes a priority. |
