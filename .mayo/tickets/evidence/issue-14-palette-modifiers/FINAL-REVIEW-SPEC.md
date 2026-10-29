# Final spec review — issue #14 (palette Return modifiers)

Range `ea58b515...e64f959`. Contract: issue #14 ACs. Parent #2 stories 35–39, 41. Issue #13 interpretations 1–7 and issue #14 interpretations 1–5 are final.

**Verdict:** No spec findings. The diff implements the ticket.

## Findings by severity

None.

**(a) Missing or partial:** none. Four Return mappings, selection vs force-search, live `flagsChanged` glyph hints, exact four-key matching, and native URL/incognito assertions are present.

**(b) Scope creep:** none user-facing. Clicks stay `.plain`. Paste, arrows, ⌘L, and `insertNewline` consumption are unchanged. Ranking/ghost/`rows(for:)` untouched. PROTOCOL `⌘-Enter` → `open.incognito` unchanged. Story 40 is out of this ticket.

**(c) Implemented but wrong:** none. S1/S2/P1 hold at `e64f959`: metadata never enters `PaletteReturnChord`; Option/Control yield `nil`; `PaletteModel` stays AppKit-free.

**(d) Ledger-referenced regression:** none.

## What was checked

`gh issue view 14` (nine ACs, 0 comments) and `2` (stories 35–41; testing decision 6; 0 comments). Both ledgers verbatim. `CONTEXT.md`. `PROTOCOL.md` palette/`open.incognito`. Diff of `mac/` plus `action`, `returnChord(from:)`, `activateSelection`, `modifierFlagsDidChange`, and `PaletteActionTests` at `e64f959`. Did not run tests (would write `.build` in the review checkout). Did not launch the app.

1. **Return opens the selected action.** Plain chord → `selectedRow.actionURL`, `incognito: false`.
2. **Shift+Return forces current text through the configured search provider.** `searchRow` on committed input (story 35).
3. **Command+Return opens the selected action in an incognito lil.** Selected URL, `incognito: true` (PROTOCOL palette ⌘-Enter; story 36).
4. **Command+Shift+Return forces search in an incognito lil.** Search URL + incognito (story 37).
5. **Exact modifier set; extras never trigger.** Equality on the four chord keys; Option/Control → no action (story 39; SI1, SI3). Caps Lock, Numeric Pad, Function, Help are stripped and do not blank the hint or block submit (SI2; P1).
6. **Selected-row hint updates while modifiers are held, with concise Mac glyphs.** `⏎ Open` / `⇧⏎ Search` / `⌘⏎ Open Incognito` / `⇧⌘⏎ Search Incognito`; `flagsChanged` refreshes it (story 38). Parent testing decision 12 still owns real-Mac hint QA.
7. **Selection except force-search, which uses current input text.** SI4: plain/⌘ use the selected row; Shift/⌘⇧ use committed input. Issue #13 SI7 ghost-text vs Enter is unchanged.
8. **Paste, editing, arrows, Command+L, submission remain fixed.** `doCommandBy` still only consumes Return/arrows (story 41).
9. **Native tests assert every exact combination and final URL/incognito flag.** Four chords assert `url`/`incognito`/`hint`; extras and metadata translation cover P1. No scoring constants (testing decision 6).

Issue #13 ordering, URL-intent, promotion, and ghost-text remain unchanged (issue #14 SI5).
