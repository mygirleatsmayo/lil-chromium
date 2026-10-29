# Remediation round 1 — issue #15

Branch: `surfx/remediation-brief-issue-15-round-1-outco-xBXnjnO5`
Reviewed code: `a236e3a20f93830c39e3bea30d1c2c2e60874058`
Ledger: `.mayosdd/tickets/evidence/issue-15-prior-context/ledger.md` (frozen; not edited)
Review evidence: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (preserved)

Scope: `extension/background.js`, `extension/test/worker.test.js`, this file.
`extension/test/chrome.js` unchanged — the public harness already fires `onRemoved` when a sole tab leaves a lil.
S1 and P2 were not coded (real-Mac QA). Protocol, fixtures, native code, ledger, and tickets were not changed.

Seam: production MV3 service-worker harness (agreed parent spec / ticket #2 testing decision 3). No new seam.

## Ledger rows

| ID | Status | What changed |
|---|---|---|
| S1 | won't-fix pending real-Mac QA | Untouched. |
| S2 | resolved | Internal app-supplied/capture-gated candidate renamed `appSuppliedPriorContext`. Public wire field and stored domain value remain `priorContext`. |
| P1 | resolved | Host/group promotion marks the source window as a lifecycle transfer so `onRemoved` does not restore prior context. Failed promotion clears the mark and leaves the lil registered. Cross-browser handoff still deregisters first. |
| P2 | won't-fix; manual seam | Untouched. |

## S2 — source-explicit internal name

`externalContext` mixed the domain term `priorContext` with the `external-app` kind. Rename only; capture gating and `msg.priorContext` mapping are the same.

- Wire → spec: `handlePortMessage` `:333` maps `msg.priorContext` onto `appSuppliedPriorContext`.
- Capture: `capturePriorContext(appSuppliedPriorContext)` `:525–532`.
- `openLil` JSDoc `:563–565`; read `:582`.
- `openIncognitoLil(url, left, top, appSuppliedPriorContext)` `:638–649`.

Registry entries, `restore-focus`, and fixtures still use `priorContext`.

## P1 — promotion is not a close

`moveTabIntoHostBrowser` still moves the sole tab before deregister. Chrome then removes the empty lil and `onRemoved` used to unwind the predecessor (Mail via `restore-focus` in the harness).

- `promotingWindowIds` `:507` is set for the source window only inside `moveTabIntoHostBrowser` (`:1250`, cleared in `finally` `:1295`).
- `onRemoved` restores only when `wasLil && wasFocused && !promotingWindowIds.has(windowId)` `:778`. Genuine closes and already-deregistered handoff are unchanged.
- Failed promotion never stays in the set, so a later focused close still restores.

Existing host-promotion test (`worker.test.js:172`): blur, open with `message-open-prior-context`, promote `dest: "host-tab"`, assert no `restore-focus`.

## Red then green (P1)

Command:

```
node --test --test-name-pattern 'promoting a lil into a host tab' extension/test/worker.test.js
```

**Red** (test assertion present; production still restored on promote):

```
✖ promoting a lil into a host tab moves it and drops the registry entry (6.272208ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
  AssertionError [ERR_ASSERTION]: promotion is a lifecycle transfer, not a close
  true !== false
```

**Green** (after `promotingWindowIds` + `onRemoved` guard):

```
✔ promoting a lil into a host tab moves it and drops the registry entry (6.018708ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

## Verification

`pnpm test` — 38/38 pass.

```
$ node --test extension/test/*.test.js
✔ fixture directory is repo-root fixtures, resolved from this file
✔ fixtures still resolve when cwd is not the repo root
✔ fixture path does not depend on HOME
✔ every shared contract fixture is readable as the same JSON object
✔ boots the production service worker, not a copy
✔ connects to the native host and asks for context
✔ context fixture lands as host identity plus config objects, with no bundle ids
✔ v1 config fixture yields the same additive defaults as the native suite
✔ v2 complete config fixture matches the context wire's config objects
✔ legacy open fixture creates a focused popup lil and registers it
✔ tab URL update is recorded on the lil registry
✔ resized lil updates registry bounds
✔ promoting a lil into a host tab moves it and drops the registry entry
✔ closing a focused lil removes it and focuses the prior window
✔ each lil restores its recorded prior context from a nested external-app chain
✔ the Close lil action restores prior context exactly once before cleanup
✔ closing an unfocused lil after WINDOW_ID_NONE does not raise a browser window
✔ a lil restores its exact related normal window despite later normal-window activity
✔ a stale predecessor lil is ignored without focusing an unrelated normal window
✔ an unregistered native popup is not mislabeled as a normal-window predecessor
✔ history-query replies with the shared history-result rows, including sparse ones
✔ promote to another browser posts open-external and removes the lil
✔ Send to lil from a normal window creates a focused popup and registers it
✔ sweep alarm is installed and a tick is harmless with no lils
✔ automatic expiry of a focused lil restores prior context before cleanup
✔ sleeping a lil stores a capture in IndexedDB and navigates to the sleep page
✔ unknown config fields are not required for the worker to apply known ones
✔ new-window target from a lil is re-parented into a cascaded lil
✔ a cascaded lil records its source lil despite incidental normal-window focus
✔ restart restoration reopens parked lils unfocused, skips quit-expiry ones, and re-registers them
✔ restart restoration remaps a nested lil chain and preserves its external root
✔ an incognito lil is focused, in-memory only, and never restored
✔ an incognito lil keeps its external predecessor in memory and restores it on close
✔ without incognito access the incognito path falls back to a normal lil and hints why
✔ a failed lil creation registers nothing
✔ a failed incognito creation falls back to exactly one registered normal lil
✔ geometry maintenance never requests focus
✔ suite runs without a live profile or the repo as cwd
ℹ tests 38
ℹ pass 38
ℹ fail 0
ℹ duration_ms 690.740083
```

`swift test` in `mac/` — 127 tests, 12 suites, pass.

`make app` — `mac/build/LilChromium.app` assembled (worktree only; live `/Applications` not replaced).

`git diff --check` — clean.

Changed files (uncommitted):

- `extension/background.js`
- `extension/test/worker.test.js`
- `.mayosdd/tickets/evidence/issue-15-prior-context/REMEDIATION-1.md`
