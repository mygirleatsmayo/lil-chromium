# Final spec review — issue #5 (lil lifecycle)

Range `c2b692e...b209517` (`28ce689`–`b209517`). Contract: issue #5 acceptance criteria. Ledger interpretations 1–4 not re-opened.

**Verdict:** No spec findings. The diff implements the ticket. Parent #2 focus/link work (#15, #17, #18) is correctly absent.

## Findings by severity

None.

## (a) Missing or partial

None.

## (b) Scope creep

None that is user-facing. Production delta is `extension/background.js` only. `mac/` and `docs/PROTOCOL.md` are untouched. Test harness (`env.startup()`, `rejectWindowCreate`) and evidence markdown are not user-facing.

## (c) Implemented but wrong

None. Ledger S1–S3 are comment/identifier-only (`a7747a3`). Unfocused restore, dual URL guard, `type: "popup"`, and `registerWindow`'s `prev` merge were not changed (settled 1–4).

## What was checked

Canonical: `gh issue view 5` (seven ACs); `gh issue view 2` only to bound what this prefactor must not ship. Code: `git diff c2b692e...b209517` plus `windows.create` / `registerWindow(` / `openLil(` at `c2b692e` vs `b209517`. `IMPLEMENTATION.md` / `REMEDIATION-1.md` treated as claims. Tests were identical at `28ce689` and `48186e6`.

1. **“App-requested opens, cascaded tabs, Send to Lil, incognito opens, and restart restoration share one lifecycle policy for creation and registration.”**  
   One lil `chrome.windows.create` and one `registerWindow(` call, both in `openLil`. Adapters: host `open`, `openIncognitoLil` (host, caret-menu, context-menu), `cascadeTabToLil` (`onCreatedNavigationTarget`, `openLinkForLil`), `sendTabToLil`, `restoreWindows`. Promote-fallback `windows.create` still builds a normal window.

2. **“Existing placement, remembered size, cascading, expiry seeding, and explicit lil focus behavior remain intact.”**  
   Each `c2b692e` adapter matches the spec now handed to `openLil`: `clampBounds`, `getLastSize` vs restore `spec.size`, `cascadeOrigin` offset-from-0 vs center, expiry `Object.assign`, `focusWindow`+`mruTouch` iff `focus !== false`.

3. **“Persistent lils are registered once; incognito lils remain in-memory only and are never restored.”**  
   Incognito returns before `registerWindow`. Restore wipes the registry, skips `"quit"`, replays persistent entries only.

4. **“Geometry maintenance never requests focus.”**  
   `onBoundsChanged` writes bounds/`lastSize` only. Test resizes while another window holds focus.

5. **“Failure at any creation step does not leave a false registry entry.”**  
   `openLil` returns before register when create yields no id. Tests: popup create reject, missing adopt tab, incognito fail → one registered normal lil.

6. **“MV3 behavior tests cover each existing lifecycle entry path and its observable registry/focus effects.”**  
   Public triggers: focused+registered (open / cascade / Send to Lil), focused+unregistered+not restored (incognito), unfocused+re-registered (restore).

7. **“No new user-facing behavior is introduced by this prefactor.”**  
   No menu, copy, protocol, or native change. Incognito access-denied fallback + hint preserved. Close-MRU refocus unchanged (ticket #15).
