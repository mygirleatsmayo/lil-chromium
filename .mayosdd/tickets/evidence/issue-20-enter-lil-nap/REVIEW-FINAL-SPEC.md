# Spec review (final) — issue #20

Refs resolve: fixed `3c36c9a97d94e5ac9211b81c94e3ec72e226a558`, HEAD `b1eb5c4a2f3a78c7ef5e36c16198aed0c7c0ce1c` (equals review head). Diff non-empty (`3c36c9a...HEAD`: 16 files, +867/−55). Commits: `a6494a2`, `04b51ec`, `c978ad9`, `b1eb5c4`.

Sources: `gh issue view 20 --comments` (empty comments), `gh issue view 2 --comments` (empty comments), issue-5 ledger, `CONTEXT.md`, `docs/PROTOCOL.md` at HEAD. Ledger S1/S2/S3 and P1/P2/P3 treated as settled; remediation review marked them resolved — not reopened.

## Findings by severity

None.

## (a) Missing or partial

None.

Issue #20 AC1–AC9 present: Lil Nap/napping copy plus “Let This Lil Nap” / “Wake This Lil” (caret, page/whitelist menus, Settings, nap hint); capture then registry (`originalUrl` / `originalTitle` / `sleepCaptureKey`) then `location.replace` release; `💤 ` title; history replace-only with capture-key rollback (S1/P2); “Shhh… this lil is napping.” and icon 96→160px (~67%); incognito never captured/napped; restore rebuilds nap URL with current `sleep.tint` (P3) and does not `windows.create` the original page; oracle vs discard (`discarded == true`, original URL) / freeze (`frozen == true`, no new document). AC9 MV3 cases cover capture, registry truth, title/history, release, restart, discard/freeze.

Parent #2 stories 69–74, 79–81 and decisions 43–45, 47–48 match this slice. Wake timing (stories 75–76, decision 46) is out of this ticket: PROTOCOL “bounded wake timing is a later ticket.” Nap shortcut (story 82, decision 49) is not in issue #20 ACs.

## (b) Unrequested

None. `scripting` + named nap-page inputs are the S1/S3 mechanisms. Internal `sleep` keys/IDs/filenames/`sleep.html` wire params `k`/`u`/`t`/`tint` stay (S2).

## (c) Implemented but wrong

None. Restore still `focus: false` (issue-5 settled 1).

## needs adjudication

None.

## Checked, not defects

`CONTEXT.md` Lil Nap / Avoid Sleep. PROTOCOL Lil Nap (v4 entry) replacement-only + oracle lines. Auto-nap still skips focused/audible/form/whitelist/incognito; manual `sleepThisLil` does not require `sleep.enabled`. Suite not executed (static review).
