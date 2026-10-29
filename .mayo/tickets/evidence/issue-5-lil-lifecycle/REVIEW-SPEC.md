# Spec review — Issue #5

**Verdict:** No spec findings. `v0.4/issue-5-lil-lifecycle` implements issue #5. Parent #2 focus/link/Command+T work is correctly left for later tickets.

## (a) Missing or partial

None.

## (b) Scope creep

None that is user-facing. Diff is `extension/background.js`, MV3 tests/harness, and the implementer's evidence file. `mac/` and `docs/PROTOCOL.md` are untouched.

## (c) Implemented but wrong

None.

## What was checked

Canonical contract: `gh issue view 5` acceptance criteria; `gh issue view 2` only for what “prefactor” / geometry / incognito must not change. Code: `git diff main...v0.4/issue-5-lil-lifecycle` plus `registerWindow(` / `windows.create` sites on `main` vs the branch. `.mayosdd/.../IMPLEMENTATION.md` treated as claims, not evidence.

1. **“App-requested opens, cascaded tabs, Send to Lil, incognito opens, and restart restoration share one lifecycle policy for creation and registration.”**  
   Single lil `chrome.windows.create` and single `registerWindow(` call, both in `openLil`. Adapters: host `open`, `openIncognitoLil`, `cascadeTabToLil` (navigation-target and context-menu new-lil), `sendTabToLil`, `restoreWindows`. Promote-fallback `windows.create` still builds a normal window, not a lil.

2. **“Existing placement, remembered size, cascading, expiry seeding, and explicit lil focus behavior remain intact.”**  
   Compared each adapter on `main` to the spec it now hands `openLil`: `clampBounds`, `getLastSize` vs restore `spec.size`, `cascadeOrigin` fallback (offset-from-0 vs center), expiry `Object.assign`, `focusWindow`+`mruTouch` iff `focus !== false`, restore `focus: false`.

3. **“Persistent lils are registered once; incognito lils remain in-memory only and are never restored.”**  
   Incognito returns before `registerWindow`. Restore clears the registry then replays persistent entries only.

4. **“Geometry maintenance never requests focus.”**  
   `onBoundsChanged` writes bounds/`lastSize` only; no `windows.update`.

5. **“Failure at any creation step does not leave a false registry entry.”**  
   `openLil` returns before register when create yields no id. Tests: popup create reject, missing adopt tab, incognito create fail → one registered normal lil.

6. **“MV3 behavior tests cover each existing lifecycle entry path and its observable registry/focus effects.”**  
   Public triggers for the five named paths: focused+registered (open/cascade/Send to Lil), focused+unregistered+not restored (incognito), unfocused+re-registered (restore).

7. **“No new user-facing behavior is introduced by this prefactor.”**  
   No menu/copy/protocol change. Incognito access-denied fallback + hint preserved.
