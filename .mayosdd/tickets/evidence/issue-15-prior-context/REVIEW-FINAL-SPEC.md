# Spec review (final) — issue #15

Range `ea58b515…18bed15`. Contract: issue `#15`; parent `#2` stories 56–58, decisions 34–37, testing 7/12; `docs/PROTOCOL.md` v4 prior-context; ledger settled 1–5.

The complete three-dot diff is **clean** on the Spec axis. No new P-findings.

## Findings by severity

None.

## (a) Missing or partial

None beyond ledger **S1** / **P2** (won’t-fix; focused real-Mac QA). Not reopened.

Present: capture before `windows.create`; one typed predecessor (lil / related normal window / external PID+bundle); nested A→B unwind; related normal window despite later MRU activity; stale lil ignored (no normal-window fallback); `WINDOW_ID_NONE` kept as external state; resize/registry omit `focused`; close consults predecessor once then deletes; promote is not unwind (**P1**); wire/domain name `priorContext` with internal `appSuppliedPriorContext` (**S2**); protocol + fixtures + native decode + MV3 production-worker tests; no Accessibility/z-order claim.

## (b) Unrequested

None. `blurBrowser`, popup-not-normal, startup remap, and `promotingWindowIds` are ticket/ledger work.

## (c) Implemented but wrong

None. **P1** and **S2** remain resolved at `18bed15`.

## needs adjudication

**NA1.** Caret `reopenIncognito` (`background.js` ~1623–1630) is a create-then-destroy of the source lil. Capture runs while the source is still focused, so the successor stores `{kind:"lil", windowId: source}`; the source is then removed unfocused, so its own predecessor (e.g. Mail) is never restored or copied. Closing the successor hits a stale lil and stops.

Issue `#15` / `#2` story 56 want unwind “to the work I came from.” Settled interp 2 names only host promotion as a non-unwind transfer. This path is unspecified.

## Checked, not defects

Issue `#5` ledger: unfocused restore, duplicate URL guards, `type: "popup"`. `CONTEXT.md` still omits related normal windows; code follows `#15`.

## Commands

- `git merge-base --is-ancestor ea58b515 HEAD` → exit 0; HEAD `18bed15`
- `git log ea58b515..HEAD --oneline` → `18bed15`, `54d81f9`, `4517c5a`, `a236e3a`
- `git diff ea58b515...HEAD --stat` → 19 files, 921/117 (non-empty)
- `gh issue view 15 --comments` / `gh issue view 2 --comments` → canonical bodies; no comments

Spec findings: 0. Worst Spec issue: none.
