# Issue #5 — Centralize lil creation and registry lifecycle

Branch `v0.4/issue-5-lil-lifecycle`. Scope: `extension/` only. `mac/` and `docs/PROTOCOL.md` untouched.

## What landed

`openLil(spec)` in `extension/background.js:550` is now the only place a lil is created, placed,
focused, and registered. `cascadeOrigin(windowId, fallback)` at `extension/background.js:595` holds
the one cascade-placement rule the entry paths previously carried by copy. Every other lil-creating
function is now a thin adapter that names an entry path and hands `openLil` a spec.

Seams under test (unchanged from issue #4): the public Chrome event / message / storage /
native-messaging surface of the production service worker, plus the observable window set, the
persistent lil registry, and the journal of `windows.*` / `tabs.*` calls. No test reaches into
`openLil` directly — every lifecycle test drives a real entry path.

## Lifecycle entry paths

| Entry path | Trigger | Adapter | Spec handed to `openLil` |
|---|---|---|---|
| App-requested open | host `open` message | `handlePortMessage` `background.js:361` | `{url, left, top}` |
| Incognito open | host `open` with `incognito`, caret-menu `reopenIncognito` (`:1572`), context menu "Open link in incognito lil" (`:1720`) | `openIncognitoLil` `:608` | `{url, left, top, incognito: true}`, falling back to `{url, left, top}` + hint (`:612`, `:619`) |
| Cascaded tab | `webNavigation.onCreatedNavigationTarget` new-lil branch, context menu "Open link in new lil" via `openLinkForLil` | `cascadeTabToLil` `:789` | `{tabId, record: fallbackUrl, left, top}` from `cascadeOrigin(src, CASCADE_OFFSET)` |
| Send to Lil | context menu `send-to-lil` in a normal window | `sendTabToLil` `:1701` | `{tabId, left, top}` from `cascadeOrigin(src)` |
| Restart restoration | `runtime.onStartup` | `restoreWindows` `:650` | `{url, record, left, top, size, focus: false, registration}` `:666` |

`openLittleWindow` is gone; its three callers now name `openLil` or `openIncognitoLil` directly.
`moveTabIntoHostBrowser`'s `windows.create` (`:1221`) is deliberately *not* routed through the
boundary — it creates a normal browser window to promote a tab **out** of the lil lifecycle.

## Acceptance criteria

### "App-requested opens, cascaded tabs, Send to Lil, incognito opens, and restart restoration share one lifecycle policy for creation and registration."

Satisfied by the table above. After the change there is exactly one `chrome.windows.create` for lils
(`background.js:568`) and exactly one `registerWindow` call site (`background.js:584`), both inside
`openLil`. Placement (`clampBounds`), remembered size (`getLastSize`), focus discipline, MRU, the
incognito set, and expiry seeding are all decided once, in that function.

### "Existing placement, remembered size, cascading, expiry seeding, and explicit lil focus behavior remain intact."

- Placement: each adapter still computes its own desired top-left and hands it in; `openLil:558`
  clamps it exactly as before. Restoration keeps passing the entry's saved `bounds.left/top`.
- Remembered size: `openLil:557` uses `spec.size || await getLastSize()`. Restoration is the only
  caller that passes `size` — its saved bounds with `DEFAULT_SIZE` fallbacks (`:671`), matching the
  pre-change code. Every other path gets the remembered last user size.
- Cascading: `cascadeOrigin:595` reproduces both prior variants. `cascadeTabToLil` passes
  `CASCADE_OFFSET` as the per-axis fallback, which equals the old `(src.left ?? 0) + CASCADE_OFFSET`;
  the three incognito/send-to-lil sites pass no fallback, so an unpositioned source still yields
  `undefined` and `clampBounds` centers the lil, as before.
- Expiry seeding: `openLil:588` defaults the entry to `{expiry: ctx.ephemeralDefault,
  lastInteraction: Date.now()}` and lets `spec.registration` layer over it. Only restoration
  overrides, with the same `normalizeExpiry(entry.expiry, "never")` and sleep marks as before.
- Explicit focus: `openLil:571-575` keeps the explicit `focusWindow` + `mruTouch` after create,
  with the same comment about `create({focused:true})` being unreliable off-frontmost.

Covered by the pre-existing tests `worker.test.js:124` (open: focused popup, `windows.update
{focused:true}`, registry `expiry: 6` from the fixture), `:238` (Send to Lil), `:290` (cascade),
`:158` (bounds), and the new `:320` (restoration keeps its own saved bounds).

### "Persistent lils are registered once; incognito lils remain in-memory only and are never restored."

`openLil` registers at most once per created window, after the id is confirmed (`:584`). An
incognito lil returns at `:577-581` — it is added to `incognitoLils` and never reaches
`registerWindow`. `restoreWindows:650` reads only the persistent registry, so an incognito lil has
nothing to be restored from.

Test `worker.test.js:378` opens one incognito and one persistent lil, asserts the incognito window
is a lil (`isEphemeral` → `{ephemeral: true, incognito: true}`) with no registry entry and a
single-entry registry overall, then boots a second worker on that stored registry, fires
`runtime.onStartup`, and asserts the restored set is exactly the persistent lil.

### "Geometry maintenance never requests focus."

The only geometry-maintenance path is `chrome.windows.onBoundsChanged` (`background.js:704`), which
writes registry bounds and `lastSize` and issues no `windows.update`. `openLil` applies placement
solely through `windows.create` — it never follows up with a bounds update — so no geometry write
anywhere in the worker carries `focused`.

Test `worker.test.js:450` resizes a lil while a different window holds focus, and asserts that the
journal entries produced by that resize contain no `windows.update {focused: true}`, that focus
stays on the other window, and that the new bounds were still recorded.

### "Failure at any creation step does not leave a false registry entry."

Structural: `openLil` returns at `:569` when `windows.create` yields nothing, before focus and before
registration. Registration is the last step and runs only against a confirmed `win.id`.

Test `worker.test.js:420` covers both shapes of failure through public entry paths: a host `open`
message while `windows.create` for popups is rejected (fresh-lil path), and a `send-to-lil` menu
click naming a tab that no longer exists (adopt path). Both assert no window and an empty registry.
Test `:438` covers the incognito create failing: exactly one registered normal lil plus the
`incognitoHint` message, never two entries.

### "MV3 behavior tests cover each existing lifecycle entry path and its observable registry/focus effects."

| Entry path | Test |
|---|---|
| App-requested open | `worker.test.js:124` (pre-existing) |
| Cascaded tab | `worker.test.js:290` (pre-existing) |
| Send to Lil | `worker.test.js:238` (pre-existing) |
| Incognito open | `worker.test.js:378` (new) |
| Incognito open, access denied | `worker.test.js:406` (new) |
| Restart restoration | `worker.test.js:320` (new) |
| Failed creation, fresh + adopt | `worker.test.js:420` (new) |
| Failed incognito creation | `worker.test.js:438` (new) |
| Geometry upkeep vs focus | `worker.test.js:450` (new) |

Two small test-infrastructure additions made those reachable, both outside production code:
`env.startup()` (`extension/test/harness.js:127`) fires `runtime.onStartup`, and
`options.rejectWindowCreate` (`extension/test/chrome.js:67`, `:134`) is a predicate over
`windows.create` options that makes the call reject.

### "No new user-facing behavior is introduced by this prefactor."

The new tests were written and passing **before** the refactor (commit `28ce689`), then re-run
unchanged after it (`48186e6`). Behavior-preserving details deliberately carried over rather than
"improved":

- `cascadeTabToLil`'s origin-fallback differs from the other three cascade sites (offset from 0 vs.
  centered). Preserved exactly via `cascadeOrigin`'s `fallback` parameter rather than unified.
- Restoration sizes from the entry's saved bounds, not the remembered last size. Preserved via
  `spec.size`.
- The registry URL fallback chain stays `record || url || tab url || ""`, so an empty `record` still
  falls through to the adopted tab's URL exactly as the old `||` chain did.
- `openIncognitoLil` keeps its own early URL guard even though `openLil` now guards too.

The one ordering change: `getContext()` is now read after `windows.create` instead of before it
(and restoration now reads it at all, only to be overridden). It is a cached, side-effect-free read
of `chrome.storage.local`, so no observable behavior depends on when it happens.

## Deliberately not done

- **No focus/prior-context work.** ADR 0003 (restore each lil's prior context) and the focus tickets
  that this one unblocks are out of scope. The MRU stack, `mruTopAlive`, and the `onRemoved` refocus
  are untouched — the boundary only ensures every create now goes through one focus decision.
- **No renaming to Lil Nap.** `CONTEXT.md` names the resource-saving state "Lil Nap", but the worker
  still says `sleep`/`slept`. Renaming is a separate ticket's user-facing change; the new tests use
  "napping" only in prose.
- **No contract change.** `docs/PROTOCOL.md`, message shapes, registry entry shape, storage keys,
  and the `mac/` side are all unchanged, so the three-component rule was never engaged.
- **`moveTabIntoHostBrowser`'s promote-fallback `windows.create` left alone** — it creates a normal
  window to move a tab out of the lifecycle, not a lil.
- **No context-menu "Open link in new lil" test.** It reaches `cascadeTabToLil` through
  `openLinkForLil`, the same adapter the covered `onCreatedNavigationTarget` path uses; a second
  test at that seam would assert the same effects twice.

## Improvement noticed, not made

`registerWindow` merges over any prior entry for the same window id (`background.js:425`). Through
the boundary that merge can never fire — ids are always new — so the `prev` merge is now dead
weight. Removing it is a behavior-visible simplification of a shared helper still called by nothing
else, so it belongs in a later ticket rather than this prefactor.

## Verification

### `pnpm test`

```
$ node --test extension/test/*.test.js
✔ fixture directory is repo-root fixtures, resolved from this file (1.182959ms)
✔ fixtures still resolve when cwd is not the repo root (0.781ms)
✔ fixture path does not depend on HOME (0.099ms)
✔ every shared contract fixture is readable as the same JSON object (2.070209ms)
✔ boots the production service worker, not a copy (5.081542ms)
✔ connects to the native host and asks for context (1.033291ms)
✔ context fixture lands as host identity plus config objects, with no bundle ids (2.303167ms)
✔ v1 config fixture yields the same additive defaults as the native suite (1.600709ms)
✔ v2 complete config fixture matches the context wire's config objects (1.189167ms)
✔ legacy open fixture creates a focused popup lil and registers it (2.05675ms)
✔ tab URL update is recorded on the lil registry (1.973375ms)
✔ resized lil updates registry bounds (1.501375ms)
✔ promoting a lil into a host tab moves it and drops the registry entry (2.700041ms)
✔ closing a focused lil removes it and focuses the prior window (2.518417ms)
✔ history-query replies with the shared history-result rows, including sparse ones (1.024667ms)
✔ promote to another browser posts open-external and removes the lil (1.663291ms)
✔ Send to lil from a normal window creates a focused popup and registers it (1.834709ms)
✔ sweep alarm is installed and a tick is harmless with no lils (1.044209ms)
✔ sleeping a lil stores a capture in IndexedDB and navigates to the sleep page (2.863459ms)
✔ unknown config fields are not required for the worker to apply known ones (1.423625ms)
✔ new-window target from a lil is re-parented into a cascaded lil (1.787333ms)
✔ restart restoration reopens parked lils unfocused, skips quit-expiry ones, and re-registers them (1.190125ms)
✔ an incognito lil is focused, in-memory only, and never restored (2.590708ms)
✔ without incognito access the incognito path falls back to a normal lil and hints why (1.454834ms)
✔ a failed lil creation registers nothing (2.369916ms)
✔ a failed incognito creation falls back to exactly one registered normal lil (1.754417ms)
✔ geometry maintenance never requests focus (1.340541ms)
✔ suite runs without a live profile or the repo as cwd (1.176083ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 685.418083
```

### `swift test` (in `mac/`)

Tail of the run; the full log is build output followed by these lines.

```
􁁛  Test encodingProviderPreservesUnknownTopLevelFields() passed after 0.002 seconds.
􁁛  Test configBundleIdBeatsTheBuiltInTable() passed after 0.002 seconds.
􁁛  Test existingNamedProviderStaysExplicit() passed after 0.002 seconds.
􁁛  Test emptySlugsAreDropped() passed after 0.002 seconds.
􁁛  Test primaryLeadsEvenWithNoLiveSockets() passed after 0.002 seconds.
􁁛  Test validCustomDraftCommitsTheTemplate() passed after 0.002 seconds.
􁁛  Test encodingExistingConfigWritesInferredProvider() passed after 0.003 seconds.
􁁛  Test launchOrderIsPrimaryFallbackThenInstalled() passed after 0.002 seconds.
􁁛  Test legacyConfigGetsAdditiveDefaults() passed after 0.006 seconds.
􁁛  Test primaryThenFallbackThenOtherLiveHosts() passed after 0.002 seconds.
􁁛  Test unknownSlugContributesNothing() passed after 0.002 seconds.
􁁛  Suite ConfigMergeTests passed after 0.008 seconds.
􁁛  Test partialSiteNameRanksTheOriginFirst() passed after 0.003 seconds.
􁁛  Suite MessageTests passed after 0.008 seconds.
􁁛  Test duplicateTargetsCollapse() passed after 0.002 seconds.
􁁛  Test nearDuplicatePagesShowOnce() passed after 0.005 seconds.
􁁛  Suite ConfigDecodingTests passed after 0.008 seconds.
􁁛  Suite BrowserCatalogTests passed after 0.008 seconds.
􁁛  Suite TintTests passed after 0.008 seconds.
􁁛  Suite PaletteRowsTests passed after 0.008 seconds.
􁁛  Suite SearchProviderTests passed after 0.008 seconds.
􁁛  Suite URLIntentTests passed after 0.008 seconds.
􁁛  Suite RoutingOrderTests passed after 0.008 seconds.
􁁛  Test protocolDocumentsEveryCatalogEntry() passed after 0.007 seconds.
􁁛  Suite BrowserTableTests passed after 0.008 seconds.
􁁛  Test profileDirectoriesAreNeverInstallTargets() passed after 0.016 seconds.
􁁛  Test missingInstallationsAreSkipped() passed after 0.023 seconds.
􁁛  Test writingManifestsCoversEveryExistingCatalogDir() passed after 0.100 seconds.
􁁛  Suite NativeHostManifestTests passed after 0.101 seconds.
􁁛  Test run with 107 tests in 11 suites passed after 0.101 seconds.
```

## Commits

- `28ce689` test(extension): pin every lil lifecycle entry path
- `48186e6` refactor(extension): route every lil through one lifecycle boundary
