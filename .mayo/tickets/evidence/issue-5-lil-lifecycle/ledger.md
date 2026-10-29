# Findings ledger — issue #5 (centralize lil creation and registry lifecycle)

Fixed point: `main` (`c2b692e`) · Branch: `v0.4/issue-5-lil-lifecycle`
Review round 1 (full, two-axis): Standards `EJ2blztI`, Spec `DQZ-iDvB`, both cursor-grok-4.6-xhigh.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Manager verification of the reports

Both reports state what they checked, so neither is a bare pass. I independently re-ran `pnpm test` (28/28) and `swift test` (107) on the branch, confirmed the diff is confined to `extension/` plus evidence, and confirmed the test-before-refactor commit order that makes criterion 7 checkable.

I hand-verified S1 and S4 against the source rather than accepting the reviewer's premise.

## Findings

| ID | Location | Verdict | Reasoning |
|---|---|---|---|
| S1 | `extension/background.js:253-254`, `:286` — comments claim "Every lil create is followed by an explicit focusWindow()" and "Always used after windows.create for a lil." | **fix** | Verified accurate as a finding. Restore passes `focus: false` (`:672`), so both comments are now false. The unfocused restore is pre-existing behavior, but this diff promotes `focus` to a first-class field on the shared boundary, which is exactly when `AGENTS.md` ("keep existing ones accurate when changing the code they describe") bites. Left alone, a later reader "fixes" restore into stealing focus. Comment-only change. |
| S2 | `extension/background.js:586` `spec.record`; `:595` `cascadeOrigin(windowId, fallback)` | **fix** | `spec.record` holds a URL, not a registry record — Mysterious Name. `fallback` collides with `CONTEXT.md`'s **Fallback browser**, in a project that maintains a ubiquitous language; `openIncognitoLil:611` separately binds `fallback` to a function, so the word now means three things in one file. Rename only. |
| S3 | `extension/background.js:787` comment "offset popup lil"; `extension/test/worker.test.js:385` "incognito popup" | **fix** | `CONTEXT.md` **Lil** lists Avoid: Popup. The API usage `type === "popup"` is correct and stays; only the prose changes. |
| S4 | Duplicated URL guard at `openLil:552` and `openIncognitoLil:609` | **won't-fix** | Verified the code. The second guard is an early-out ahead of the async `isAllowedIncognitoAccess()` round-trip, not redundant logic — removing it makes the incognito path do a permission check for input it will reject anyway. Two lines; extracting costs more than it saves. |
| P1–Pn | — | none | Spec axis returned no findings across all seven acceptance criteria, each checked against `main` for behavior preservation. |

## Settled interpretations

These are final. No later round may fail them.

1. **Unfocused restore is correct and intended.** `restoreWindows` passing `focus: false` is preserved v0.3 behavior, not a regression. `docs/PROTOCOL.md`'s focus discipline governs user-initiated creates; restoration is exempt. S1 fixes the comments to say so — it must not change the behavior.
2. **The duplicated URL guard stays** (S4). Do not extract it.
3. **`type: "popup"` stays in code.** Only human-facing prose adopts "lil" (S3).
4. **`registerWindow`'s now-unreachable `prev` merge is out of scope.** The implementer flagged it; removing it alters a shared helper's behavior, which criterion 7 forbids in this prefactor. It belongs in its own ticket.

## Round 1 outcome

3 fixes owed (S1, S2, S3), all confined to comments, test prose, and two identifier renames. No behavior change is owed or permitted.
