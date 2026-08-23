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

## Final full review round 1

Reports: `REVIEW-FINAL-STANDARDS.md`, `REVIEW-FINAL-SPEC.md` (this directory).

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| S1 | Standards | `docs/PROTOCOL.md` still says the Settings row matches query prefixes | **fix** | Update the contract sentence to the already-settled P1 behavior: only the complete case-insensitive words `settings` and `preferences` match. Production and tests are already correct. |
| P2 | Spec | Same stale `docs/PROTOCOL.md` prefix sentence | **fix through S1** | Duplicate of S1; no additional product behavior change is owed. |

Final round 1 found contract drift only. One documentation-only fix is owed before repeating the remediation review and final full review.

## Manager close-out

S1 and duplicate P2 are resolved by `8bd0539cdf44dd3ca1ac07cb6d472ff05a00eab1`: `docs/PROTOCOL.md` now states the settled complete-word rule. Per owner direction, this one-line prose correction was checked directly rather than sent through another worker review round. Focused palette tests, the full extension and Swift suites, release build, and `git diff --check` passed.
