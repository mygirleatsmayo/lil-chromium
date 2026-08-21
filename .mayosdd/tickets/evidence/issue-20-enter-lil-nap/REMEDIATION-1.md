# Remediation 1 — issue #20 (enter Lil Nap)

Frozen ledger: `ledger.md` at `04b51ecce41db11702f2bcb338ceaf15f6f51a1c` (pre-fix point). Reviewed implementation `a6494a20a4350e9c372353f2013e0c87dff79a06`. Seam unchanged: production MV3 service worker in Node against the fake Chrome/IndexedDB boundary (`extension/test/harness.js`). Each fix landed test-first (red → green); P1/P2 resolve through their duplicate Standards findings (S2/S1 respectively).

## S1 — replacement-only release, truthful failure + rollback (also resolves P2)

**Settled:** successful entry requires history replacement; if replacement is unavailable/fails, leave the live document truthful, roll back nap registry/capture state, report failure; never degrade to history-pushing navigation.

**Changes (`extension/background.js`):**

- `replaceTabDocument` — removed the `tabs.update` fallback. When `chrome.scripting.executeScript` is absent or rejects, it returns `false` and the live document is never navigated.
- `sleepLil` — checks the release result. On failure it rolls back the nap-only registry fields (`slept`, `sleepCaptureKey`, `originalUrl`, `originalTitle` — guarded by the fresh capture key so only this entry's marks are touched) and deletes the newly stored capture, logs the failure, returns `false`. Capture-before-release ordering and shared manual/automatic entry are unchanged.
- `sleepThisLil` message reply is now truthful: `{ ok: slept }` instead of unconditional `{ ok: true }`.
- `docs/PROTOCOL.md` Lil Nap entry — contract states replacement is the only release path and failure rolls back nap state.

**Harness (Chrome-boundary fakes only):** `extension/test/chrome.js` gains `scripting: false` (permission absent ⇒ `chrome.scripting` undefined) and `rejectScripting(tabId)` (executeScript rejects), mirroring the existing `rejectWindowCreate` knob.

**Rollback oracle (test helper `assertTruthfulRollback`, `extension/test/worker.test.js`):** reply `ok === false`; tab URL and title unchanged; session history still exactly `[originalUrl]`; registry entry keeps the lil registered with all four nap fields absent; capture store empty; and the journal contains **no** `tabs.update` to a `sleep.html` URL (absence of history-pushing fallback). Red before the fix (failed on the untruthful `ok: true`; the fallback also navigated), green after, under both fault modes:

- `when document replacement is unavailable, Lil Nap entry fails truthfully and rolls back nap state`
- `when document replacement fails, Lil Nap entry fails truthfully and rolls back nap state`

Success path still asserted by `the nap document replaces rather than pollutes back/forward history` (history becomes `[napUrl]` via `location.replace`).

## S2 — user-facing copy uses Lil Nap/napping (also resolves P1)

**Changes:**

- `extension/background.js` — whitelist context menu: `Never nap this site`; dynamic `Never nap {host}` / `Allow napping {host}` (plus the section comment mirroring the titles). Internal ID `toggle-whitelist`, message action `sleepThisLil`, and all other internal keys unchanged.
- `mac/Sources/LilChromiumApp/SettingsWindow.swift` — whitelist placeholder `Add domain (never nap)` (label-only hunk; `/swiftui-pro`: no API/data-flow/accessibility concerns, placeholder still describes purpose).
- `docs/PROTOCOL.md` — behavior prose now uses nap language (`auto-nap`, `never napped`, `napping lils as nap documents`, menu titles) while legacy internal identifiers (`sleep` config key and sub-fields, `sleep.html`, `sleep.tint`, `slept` registry field) stay literal and are called out as such.

**Verification:** red → green test `the whitelist context menu uses napping language` (static title, per-host title, toggled title). `rg -i "never sleep|allow sleeping|never slept|auto-sleep|auto-slept|sleep pages|sleeping lil"` over `extension/`, `mac/Sources/`, `docs/` finds only internal code comments. Existing test `the page context menu action is Let This Lil Nap` unchanged and green.

## S3 — one named nap-page input value (also covers the S3 half of restore)

**Changes (`extension/background.js`):** `sleepPageUrl` now takes a single named object `{ captureKey, originalUrl, originalTitle, tint }` so the inputs cannot shift positionally or be silently omitted; both call sites (entry in `sleepLil`, restore in `restoreWindows`) pass the same named shape. Wire URL unchanged: params `k`/`u`/`t`/`tint` on `sleep.html`; legacy storage/config identifiers (`slept`, `sleepCaptureKey`, `originalUrl`, `originalTitle`, `sleep.*`) untouched.

**Verification:** the pre-existing entry/restore tests asserting `k`, `u`, `t` params stayed green through the signature change (wire compatibility); `entering Lil Nap captures…` now also asserts the entry URL carries the configured tint (`#3311aa` from the shared context fixture).

## P3 — restart restoration keeps the configured tint

**Changes (`extension/background.js`):** `restoreWindows` reads the current context once and rebuilds each nap page with `tint: ctx.sleep.tint`. The normalized context carries the configured tint, or the existing default (`DEFAULT_SLEEP.tint`, `purple`) only when configuration supplies none — so a lil napped under a gray/custom tint no longer restores purple.

**Verification:** red → green test `a browser restart rebuilds the nap page with the current configured tint, defaulting only when none is configured` — red with `null !== '#3311aa'` before the fix; green after: configured tint `#3311aa` on restore, `purple` only when no tint is configured. `docs/PROTOCOL.md` restore sentence updated to match.

## Focused red-green MV3 checks (final green)

```
✔ entering Lil Nap captures the visible lil and records original URL, title, and capture identity before releasing the document
✔ the nap document replaces rather than pollutes back/forward history
✔ when document replacement is unavailable, Lil Nap entry fails truthfully and rolls back nap state
✔ when document replacement fails, Lil Nap entry fails truthfully and rolls back nap state
✔ a browser restart restores a napping lil as a nap document without live-loading the original page
✔ a browser restart rebuilds the nap page with the current configured tint, defaulting only when none is configured
✔ the page context menu action is Let This Lil Nap
✔ the whitelist context menu uses napping language
✔ automatic Lil Nap records the same capture and registry truth as a manual entry
ℹ tests 9 · pass 9 · fail 0
```

## Full verification

- `pnpm test` — 49 pass, 0 fail (45 worker + 4 fixture).
- `swift test` in `mac/` — 141 tests in 13 suites passed.
- `make app` — `Done: mac/build/LilChromium.app` (isolated worktree build only; no install/launch/reload of the live app, browser, extension, or host).
- `git diff --check` — clean.

## Boundaries kept

Incognito exclusion (guards + `never captured or napped` test) untouched; issue #5 lifecycle paths untouched; wake behavior (#21) untouched — `wakeLil`, the sleep page's click-to-wake, and wake timing are as reviewed. Ledger and both first-review reports unmodified. No expansion into #22/#24, no unrelated refactors, no GitHub/other-branch/source-checkout mutation.
