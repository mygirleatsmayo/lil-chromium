# Remediation round 1 — issue #7

Worktree: this Surfx checkout (`surfx/remediation-brief-issue-7-round-1-outcom-DzkgffGG`).
Reviewed code: `ddb624741edcc9a09474f0b724b751f308bfc848`. Ledger unchanged.
Live tickets: `gh issue view` GraphQL project fields 403; REST bodies of #7 and parent #2 read; both have 0 comments.
Review evidence (`ledger.md`, `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md`) left in place. Changes uncommitted.

## Ledger rows

| ID | Status | What changed |
|---|---|---|
| S1 | resolved | Hoverbar promote button and ⌘O now call `promote("primary")`, matching the caret action. Routing still falls through to Primary (`promoteTab` treats any non-group/host-tab/browser dest as Primary). |
| S2 | resolved | Fallback warning `Image` keeps yellow SF Symbol + `.help("Choose an installed browser other than Primary.")` and now has the same string as `.accessibilityLabel`. Primary warning hunk untouched. |
| P1–Pn | none | Spec axis had no findings. |

## Changed files

- `extension/overlay.js` — two dest tokens (`promoteBtn` click, ⌘O). Caret `promote("primary")` already correct.
- `mac/Sources/LilChromiumApp/SettingsWindow.swift` — one `.accessibilityLabel` on the Fallback warning only.
- `.mayosdd/tickets/evidence/issue-7-primary-fallback/REMEDIATION-1.md` — this file.

## Test-seam decision

Agreed seams (parent #2): native public model/router/config/contract; production MV3 service-worker harness with shared JSON fixtures. No DOM source-inspection, no SwiftUI view inspection, no static-source regression tests.

- **S1:** Overlay is not in the SW harness. `dest: "primary"` vs `"default"` is not observable there — both already promote to Primary. Existing `promoting a lil into a host tab…` / `promote to another browser…` cover other dests, not this token. No new test.
- **S2:** VoiceOver label is not on the native public seam. Closest existing tests (`fallbackChoicesExcludePrimaryButKeepSiblingChannels`, `identicalLegacyLaunchTargetsStillReachAnotherInstallation`) cover Fallback identity, not the icon. No new test.

`/mayosdd-tdd`: no red-green slice; existing focused + full suites as verification.

## Commands and results

Focused S1:

```
node --test --test-name-pattern 'promot' extension/test/*.test.js
```

3 pass, 0 fail (includes `promoting a lil into a host tab…` and `promote to another browser…`).

Focused S2 (existing Fallback identity tests; no a11y seam):

```
cd mac && swift test --filter 'fallbackChoicesExcludePrimaryButKeepSiblingChannels|identicalLegacyLaunchTargetsStillReachAnotherInstallation'
```

2 tests in 2 suites passed.

`pnpm test` — 28 pass, 0 fail.

`swift test` in `mac/` — 130 tests in 12 suites passed.

`make app` — release build assembled at `mac/build/LilChromium.app`. Did not run `make install` or any live reload.

`git diff --check` — clean (exit 0).
