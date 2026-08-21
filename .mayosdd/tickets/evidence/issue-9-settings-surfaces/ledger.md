# Findings ledger — issue #9 (native Settings from every surface)

Fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` · Reviewed code: `6cdf9d064931857cdea9405721492822e678e2ff`.

Review round 1 (full, two-axis): Standards `LVvpvojD`, Spec `aUcQZe08`, both `cursor-grok-4.6-xhigh`.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Findings

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| P1 | Spec | `SettingsAction.matchesQuery` and Settings-row placement | **fix** | The dedicated Settings row may lead for the complete case-insensitive queries `settings` and `preferences`. Partial stubs such as `set` and `pref` remain ordinary non-URL palette queries; parent #2 ordering rule 21 allows only a registrable-domain literal to outrank Search otherwise. |

## Standards axis

No findings. Contract lockstep, AppKit isolation, Swift Testing style, terminology, and the smell baseline passed.

## Round 1 outcome

One small Spec fix is owed. No owner adjudication is required before remediation.
