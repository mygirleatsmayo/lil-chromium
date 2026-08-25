# Issue #33 — keep Lil Nap wake inside the napping lil

Branch: `surfx/issue-33-keep-lil-nap-wake-inside-the-na-qtQFcBUY`
Scope: extension-owned wake placement. No Swift, protocol, Nap policy, or #31/#32 focus changes. `docs/scratch/lil-chromium-focus-bug-hunches.md` was used only as untrusted hypothesis fuel and discarded where it conflicted with code or new evidence (in particular the claim that `wakeLil` has “no code path” that can place a tab in another window).

## Root cause

`wakeLil` asked `chrome.tabs.create({ windowId: <lil>, url, active: false })` and treated a successful return as a same-lil preload. It never compared `freshTab.windowId` to the requested lil. If Chromium/Helium placed that tab in Primary, the worker still activated it and removed the nap tab. Removing the last tab emptied the popup; `windows.onRemoved` deregistered the lil. The original URL survived as a new tab in Primary.

This is #21 Chrome-extension finding F4, previously `won't-fix` pending real-Mac evidence. Live Helium QA (#26 / this session) is that evidence.

`sleep.js` `location.replace` cannot explain a *new* Primary tab. A missing registry would fail `wakeLil` and leave in-place fallback in the nap document. Observed: the nap document existed (`sleep.html` with capture key `110440991-1787687942615`); after wake the lil window was gone and Primary’s original-URL tab count went 1 → 2.

## Agreed seam

Production MV3 service worker (`extension/background.js`) loaded by `extension/test/harness.js` against the fake Chrome / IndexedDB boundary. Public `wakeLil` message. New opt-in fake: `relocateTabCreate` maps `tabs.create` options to another live window id while the call still succeeds.

## Red before the fix

Harness injection: Primary normal window + napping lil; `tabs.create` for the lil’s original URL is returned in Primary.

```
node --test --test-name-pattern 'when the wake preload is returned in another window' extension/test/worker.test.js
```

Failed at `assert.ok(woken, "wake must not empty and close the lil")` — `woken` was `undefined` (lil window gone). Second test (`a relocated wake preload that cannot replace in place…`) failed `ok: false` because production reported `ok: true` after “succeeding” the swap into Primary.

## Fix

One shared predicate, `wakePreloadIsInLil`. After create, a missing or other-window tab is dropped (`tabs.remove` of that preload only — never the nap tab) and wake uses the existing replacement-fallback (floor, then `replaceTabDocument` on the nap tab). If replacement also fails, nap registry/capture stay truthful and the reply is `ok: false`. Same-window success, activation failure, and nap-tab removal failure are unchanged.

Sole production caller of the swap is the `wakeLil` runtime message (`sleep.js` click). Commands only enter Nap (`let-this-lil-nap`).

## Live Helium (current v0.4 trial, unfixed worker)

Lucas woke the already-napping lil. No extension reload, no SW probe (so `tabs.create` request/return ids were not observed inside the worker).

Command used with transient snapshots outside the durable evidence set:

```
node .mayosdd/tickets/evidence/issue-33-nap-wake-regression/live-wake-trace.mjs compare \
  .mayosdd/tickets/evidence/issue-33-nap-wake-regression/helium-before-wake.json \
  .mayosdd/tickets/evidence/issue-33-nap-wake-regression/helium-after-wake.json
```

Exit 1, `verdict: fail`.

| Identity | Value | Source |
|---|---|---|
| nap sender window | `110440991` | `sleep.html` in that window before wake |
| requested preload window | `110440991` | nap-page window (sender); not SW `tabs.create` |
| returned fresh-tab window | `110440584` | inferred: new original-URL tab in Primary |
| nap-tab removal | true | lil window gone; no SW `tabs.remove` events |
| lil-window removal | `110440991` | absent after wake |
| registry | unobserved | capture key from URL: `110440991-1787687942615` |
| final destination | Primary `110440584` `mode:normal` tab 9, `https://www.hyperagent.com/docs/billing/pricing-changes` | after snapshot |
| final Helium focus | window `110440584` index 1 | after snapshot |

Counts: Helium windows 2 → 1; original-URL tabs 1 → 2; napping lils 1 → 0.

Artifact: sanitized `LIVE-TRACE.json`. The unrelated tabs from the transient before/after snapshots are deliberately not retained.

## Commands and results

### Focused red

`node --test --test-name-pattern 'when the wake preload is returned in another window|a relocated wake preload' extension/test/worker.test.js`

- red: lil gone; wake reported success into Primary
- after fix: both pass

### Focused green (wake family)

`node --test --test-name-pattern 'wake |napping lil leaves|inactive same-window wake|mid-swap redirect|cannot tell whether a nap|redirect on the fresh document mid-swap|back/forward history holds no stale' extension/test/worker.test.js`

17 tests, pass 17, fail 0 (including existing #21 transition/identity/cleanup cases plus the two new relocate cases). See `pnpm test` for the full 142.

### `pnpm test`

```
ℹ tests 142
ℹ pass 142
ℹ fail 0
```

(`pnpm install` first in this worktree so `linkedom` was present for `sleep-page.test.js`. No Swift, no `make install`.)

## Changed files

- `extension/background.js` — `wakePreloadIsInLil`; relocated/missing preload drops the misplaced tab and uses replacement fallback
- `extension/test/chrome.js` — `relocateTabCreate` injection
- `extension/test/worker.test.js` — relocated-preload success and relocated+replacement-failure tests
- `.mayosdd/tickets/evidence/issue-33-nap-wake-regression/` — `live-wake-trace.mjs`, `sw-probe.js`, sanitized `LIVE-TRACE.json`, this report

## Remaining HITL

Green live Helium still needs this worktree’s extension loaded (not done here: live reload is out of scope). Then:

1. Nap a lil (or use a fresh napping lil).
2. Optional: paste `sw-probe.js` into the service-worker console for exact create/remove ids.
3. Run:

```
node .mayosdd/tickets/evidence/issue-33-nap-wake-regression/live-wake-trace.mjs hitl --out .mayosdd/tickets/evidence/issue-33-nap-wake-regression/LIVE-TRACE-GREEN.json
```

4. Click the napping lil once, then Enter.

Until that reload, the stored live artifact is the **red** current-trial run, not a green proof.
