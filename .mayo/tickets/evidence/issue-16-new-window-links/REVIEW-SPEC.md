# Spec review — issue #16

Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2`  
Review head: `b43cdfe0d50918c4b5a2d8ab492ecd61661aabb2`  
Diff: `git diff 3ce95733…b43cdfe0` (non-empty: `background.js`, `PROTOCOL.md`, MV3 harness/tests, evidence).

No Spec findings.

## What was checked

**#16 ACs (all nine).** Ordinary same-target navigation never raises `onCreatedNavigationTarget` and stays in the source lil. After removing `noOpener` from branch 1, opener-less normal-window spawns (`rel="noopener"`) take branch 2 and honor live `linkBehavior` (including hot-applied `config-update`, ledger #12). ⌘ `clickHint` is consumed only on branch 2, so it flips only requested-target behavior and does not run on preserved popup/OAuth. Classification still waits on `settleTabAndWindow` (`tabs.get`/`windows.get` retries) per `docs/PROTOCOL.md` “WAIT for the tab to settle (retry `tabs.get`/`windows.get`)”. Preservation is popup type **or** requested/settled OAuth guard; “A missing `openerTabId` alone is NOT decisive” matches #16 AC5 and parent #2 decision 28 (“Do not classify every missing opener as sufficient evidence by itself”). Popup/OAuth paths return with no re-parent, navigate, or registry write (AC6; parent stories 44/28). New-lil uses `cascadeTabToLil` → `openLil` with explicit `{kind:"lil"}` prior context and create-then-`focusWindow` on the new lil only (AC7; parent story 55; ledger #15 nested-create). Same-lil is navigate → remove → `focusWindow(source)` (AC8; PROTOCOL branch 2). MV3 tests added/rewritten for ordinary links, both behaviors, modifier, settle races, native popups, auth hosts, and the #18 event-order race.

**#18 ledger S1.** Link-owned tabs still cannot be converted by `tabs.onCreated` (`linkOwnedTabIds` unchanged). Opener-less link spawns are now classified by #16 as genuine targets, not leave-alone; the rewritten race test still asserts exactly one link-flow re-parent. PROTOCOL #18 leave-alone text now matches: “popup window, OAuth guard”.

**Unrequested production behavior.** None. PROTOCOL and harness (`openerTabId`, `settleMisses`) only document/test the classification change. `mac/` and wire/config vocabulary untouched (parent decision 51: no new identity/config/message).

**Ledgers #5, #17.** No lifecycle or context-menu changes in the diff.
