# Final Spec review — issue #16

Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2`  
Review head: `b43cdfe0d50918c4b5a2d8ab492ecd61661aabb2`  
Range confirmed non-empty (`docs/PROTOCOL.md`, `extension/background.js`, MV3 harness/tests). Ledger S1 (test-setup extraction) is settled **won't fix**; not reopened.

**No Spec findings.**

## What was checked

**#16 ACs (all nine), quoted:**

- Ordinary same-target stays in-lil (`tabs.update` only; no `onCreatedNavigationTarget`) — “An ordinary same-target link navigates the current lil without creating another window.” Parent #2 story 42 / decision 27.
- Opener-less normal-window spawn (`rel="noopener"`) takes branch 2 after `noOpener` was removed — “A missing opener alone is not decisive”; parent #2 decision 28: “Do not classify every missing opener as sufficient evidence by itself.” Honors live `linkBehavior` including hot-applied `config-update` (ledger #12).
- ⌘ `clickHint` consumed only on branch 2; consumed hint does not leak to the next spawn — “The established per-click Command override flips only that requested-target behavior.”
- Still waits on `settleTabAndWindow` (`tabs.get`/`windows.get` retries) — “Classification waits for the created tab and window to settle before acting”; PROTOCOL: “WAIT for the tab to settle (retry `tabs.get`/`windows.get`)”. Final URL can match the OAuth guard after redirect.
- Preservation = settled `type === "popup"` **or** requested/settled OAuth guard; opener is retained, not a solo classifier — AC5/AC6; PROTOCOL: “A missing `openerTabId` alone is NOT decisive”; parent story 44 / decision 28.
- New-lil: `cascadeTabToLil` → `openLil` with `{kind:"lil", windowId: source}`, create-then-focus on the new lil only, no `windows.update({focused:true})` on the incidental host — AC7; parent story 55; PROTOCOL prior-context: “Nested creates explicitly name their source lil”; ledger #15 nested-create.
- Same-lil: navigate → remove → `focusWindow(source)` — AC8; PROTOCOL branch 2.
- MV3 cases: ordinary link, new-lil, same-lil, both modifier flips, settle miss/late/never, native popup (with and without opener), Google OAuth path + `auth0.com` suffix — AC9; parent testing decision 3.

**#18 ledger S1/P2.** `linkOwnedTabIds` still claims at listener entry; opener-less link spawn is one link-flow re-parent, never dual conversion. PROTOCOL leave-alone list now “popup window, OAuth guard” (missing opener dropped as a leave-alone rule).

**Unrequested / lockstep.** Production delta is classification only. `mac/` and wire/config untouched (parent decision 51). Harness `settleMisses` / popup `openerTabId` are test-only.

**Ledgers #5, #17.** No lifecycle or context-menu change in the range.
