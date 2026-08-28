# Spec review (final) — issue #17

Range `3c36c9a97d94e5ac9211b81c94e3ec72e226a558…89ac85201d58f688434bd7026f8aefd9c90aaaea`. Contract: issue `#17`; parent `#2` stories 46–52, decisions 29–32, testing 5; `docs/PROTOCOL.md` context-menu / incognito-lil lines; ledgers `#17` (S1, P1, P2), `#5`, `#15`.

Complete three-dot production/test/protocol diff is **clean** on the Spec axis. No new P-findings. Settled interpretations respected; none need adjudication.

## Findings by severity

None.

## (a) Missing or partial

None. Ledger **P1** / **P2** remain resolved: items create with `visible: false` then `applyContextMenusForFocusedTab`; context-menu incognito explain is `broadcastToWindow` only.

Present vs `#17` AC1–9 / `#2` 29–31:

- One `contextActionAllowed` table for visibility and `onClicked`.
- This-lil only for a registered lil (hidden + inert elsewhere).
- New-lil and incognito-lil on eligible normal and registered-lil pages; incognito pages omit this-lil, new-lil, and send.
- New-lil from a normal tab: focused registered lil, `kind:"normal-window"` predecessor, source need not be a lil.
- Context-menu incognito: Allow-in-Incognito gate; explain on the source page; no open, drop, or de-privatize (palette/caret `queueIncognitoHint` fallback preserved).
- Page Send and tab-strip Send Tab to Lil share `sendTabToLil` → `openLil`.
- Unsupported/throwing `tab` create omits that item; other menus still load.
- MV3 production-worker tests cover those menus, registry, focus, reparenting, and capability omission.

Protocol lockstep is extension-only; `mac/` correctly untouched.

## (b) Unrequested

None. `isRegisteredLil`, post-create menu refresh, and retiring `openLinkForLil`’s new-lil-from-lil-only mode are the `#2` further-note / decision 30 root fix.

## (c) Implemented but wrong

None. **S1** (`CTX_THIS_LIL` / this-lil, not `linkBehavior`), **P1**, **P2** still hold at HEAD.

## needs adjudication

None.

## Checked, not defects

`#5`: unfocused restore, duplicate URL guard, API `type:"popup"`. `#15`: `WINDOW_ID_NONE` skipped only for menu sync; promote unwind unchanged; NA1 caret reopen still deferred. Brief all-hidden before first policy query is the P1 settled conservative direction. Sleep/whitelist stay in the same policy; Lil Nap copy is out of `#17` (protocol still “Sleep this lil”). Decision 33 Cmd+T conversion is out of ticket scope.

## Commands

- refs resolve; HEAD = `89ac852`
- `git log 3c36c9a..HEAD --oneline` → `89ac852`, `2a05d7e`, `cfd805f`, `bce7b7e`, `d4ee5ba`
- `git diff 3c36c9a...HEAD --stat` → 10 files, non-empty (`docs/PROTOCOL.md`, `extension/background.js`, tests, evidence)
- `gh issue view 17 --comments` / `gh issue view 2 --comments` → bodies; no comments

Spec findings: 0. Worst Spec issue: none.
