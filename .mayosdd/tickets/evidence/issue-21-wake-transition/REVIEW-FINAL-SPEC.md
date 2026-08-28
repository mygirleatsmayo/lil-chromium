# Final Spec review — issue #21

**Verdict:** No spec findings. No `needs adjudication`.

Fixed `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` · head `95fecc235812d27796e3b32bacce40bf79da4724` (both resolve; full-branch diff non-empty). Issue #21 commits only: `1b2673b7`, `5561c6c5`, `f1354d83`, `f8c9ce88`, `9ae96ee`. Overlay/`let-this-lil-nap` sharing the range are other v0.4 tickets. Ledger (incl. A1, P1–P5, F1–F5, O1–O2) not reopened. Skill `/chrome-extension` v1.1.0 routed refs: service-worker, messaging-rpc, storage, content-scripts, web-accessible-resources, permissions, debugging-mistakes.

Sources: `gh issue view 21` (0 comments), parent `#2`, blocker `#20` as named, `docs/PROTOCOL.md` Wake (v4), this directory’s ledger + reviews.

## (a) Missing or partial

None.

## (b) Unrequested

None user-facing. Keyboard wake (Enter/Space/Escape) predates the ticket. `lastInteraction` on cleanup is registry hygiene, not a new product surface.

## (c) Implemented but wrong

None. Worker preload/swap, 180 ms floor, 500 ms cap, `status: "complete"` after subscribe plus current-tab inspect, success-only `clearNapState`, failure truthfulness, page fallback only on `{ok:false}` / `lastError` / throw / 1000 ms silence, 150 ms cleanup race, leftover backstop only when the visible document left and no nap document remains — all match issue #21 and PROTOCOL Wake (v4). F2 (scripting the extension nap page) stays evidence-gated.

## Checked

1. **AC1–4 / #2 US 75–76, ID 46; PROTOCOL** inactive same-window original-URL load; image held to 180 ms; swap on ready after that; cap 500 ms (preload-unavailable path holds the floor then replacement-only).
2. **AC5–7 / #2 US 59, 77–78, ID 44–46; PROTOCOL** new `documentId`; nap-only fields cleared, lil kept, capture deleted; nap tab gone so no `sleep.html` in history.
3. **AC8 / PROTOCOL fallback + leftover** failed activate/remove/total-nav leave nap state; page `location.replace` after explicit failure or 1000 ms unreachability (A1); hung storage does not strand; worker reconciles when the visible URL leaves.
4. **AC9 / #2 TD 3, 9, 12, 14** controlled-clock MV3 tests + document identities; visible animation remains real-Mac QA.
5. **#20** entry replacement-only / restart-as-nap-document / oracle unchanged; wake does not resume the released document.
