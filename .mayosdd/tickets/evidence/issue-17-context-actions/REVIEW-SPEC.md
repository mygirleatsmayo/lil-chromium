# Spec review — issue #17 (round 1)

Range: `3c36c9a`…`d4ee5ba` (one commit). Sources: issue #17, parent #2, ledgers #5/#15, `CONTEXT.md`, `docs/PROTOCOL.md` at review head.

## Findings

### P1 (Medium) — Menus are created visible-by-default; no initial policy sync

`createContextMenus` creates all six items without `visible` (Chrome default `true`), and nothing applies the policy at install/startup (`extension/background.js:1777-1796`; `onInstalled` `:1912-1916`). Visibility syncs only on tab/focus/URL events (`:1837-1848`) and post-register (`:632-635`). After any install/update, until the first such event, every item shows everywhere: "Open link in this lil" on a normal page, "Send to lil" inside a lil, and on incognito pages the items the contract omits.

Violates the ticket outcome "Show and authorize each extension context action **only where its label is true**", AC1 "One context policy controls both menu **visibility** and click authorization", AC2 "Open link in this lil **exists only** for links invoked inside a registered lil", and `docs/PROTOCOL.md`: "Incognito pages **omit** this-lil, new-lil, and send". Click authorization still denies via the same table (`:1866`) — no wrong action executes, but labels transiently lie after each update.

### P2 (Low) — Incognito explain path leaves a stale one-shot hint that replays later

`openLinkInIncognitoLil`'s explain path calls `queueIncognitoHint(tab.windowId)` (`:1367`), which broadcasts immediately and adds a `pendingIncognitoHints` entry (`:671-675`) consumed only by the overlay's mount-time poll (`overlay.js:216`, `background.js:1683-1688`). The source page's overlay is already mounted, so the broadcast explains now; the pending entry survives and re-fires the "Allow in Incognito" toast on any later reload of that tab, detached from the user's action. AC5 asks only that the gate "explains disabled access"; the unrequested replay risks teaching users to dismiss it. (The palette fallback path is unaffected: its entry is consumed when the fallback lil's overlay mounts.)

## Checked, no findings

- AC1 policy sharing at event time; AC2 this-lil gating; AC3 new/incognito-lil availability; AC6/AC7 shared `sendTabToLil` reparent; AC8 isolated tab-strip create (lastError + throw); AC9's 13 MV3 tests (menus, registry, focus, reparenting, unsupported capability). Matches parent decisions 29–31 and testing decision 5.
- AC4: `openLinkInNewLil` (`:1348`) needs no lil source; focused, registered, predecessor `normal-window`; lil sources record `kind:"lil"` per issue #15.
- AC5 gate: denied access and failed create both explain without opening, dropping, or de-privatizing; incognito lils never registered (`openLil` `:610-616`).
- No other unrequested behavior: the `isRegisteredLil` split, post-register refresh, and `openLinkForLil` new-lil mode removal are the requested root fix (decision 30). Protocol updated in lockstep; extension-internal change, so untouched `mac/` is correct. Settled interpretations respected.
