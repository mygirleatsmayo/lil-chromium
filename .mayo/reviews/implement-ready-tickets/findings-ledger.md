# Integration branch findings ledger

Whole-branch review of `feat/implement-ready-tickets` (tickets #38, #39, #40, #41, #42, #43, #44, #46, #47). The per-ticket ledgers in `.mayo/reviews/issue-*/` stay in force.

Original fixed point: `main` (`8ed6c32`)
Initial reviewed point: `0db3180`

## Standards

- S1 · The palette's search URL leaves `&`, `+`, `=` unencoded (`Config.swift` `searchURL(for:)`, used by Tab, the Search row and ⇧Return); `R&D` searches for `R`. The hoverbar encodes them · **fix** · Settled (Lucas: share the search logic): the palette and the hoverbar build the same search URL for the same text and engine, with the typed text as one query value (`R&D` → `R%26D`, `C++` → `C%2B%2B`). The rule is stated once in `docs/PROTOCOL.md` and checked by one shared fixture that both suites run, as URL intent is.
- S2 · A typed absolute path is not escaped as a path: `/tmp/report#1.txt` opens `/tmp/report` (`URLIntent.swift` rule 4, `background.js` `urlIntent`) · **fix** · Settled (match Chrome): a typed path (rule 4, and rule 5's expanded `~` path) opens the file at exactly that path. `%`, `;`, `#`, `?`, `\`, space and control characters are escaped before the path becomes a `file://` URL, so `/tmp/a%20b` names a file called `a%20b`. A typed `scheme://` URL is unchanged. Source: Chromium `net/base/filename_util.cc` `FilePathToFileURL` (chromium.googlesource.com, `main`).
- S3 · Twelve rows can extend below a ~700-point visible frame (`PaletteController.swift` panel height) · **won't-fix** (Lucas): no real screen is that small, and the row count is a setting.
- S4 · Swift and the extension disagree on whitespace (U+0085 counts in Swift only; U+FEFF in JavaScript only), so trim and rule 6 differ across surfaces · **fix** · Settled (match Chrome): both sides trim and detect whitespace with Chrome's set: ASCII whitespace plus U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000; not U+FEFF. The shared fixture covers U+0085 and U+FEFF. Source: Chromium `base/strings/whitespace_constants.h`.
- S5 · Palette ranking and history refresh use GCD (`DispatchQueue`, `DispatchWorkItem` in `PaletteController.swift`); swiftui-pro `references/swift.md`: never use GCD · **fix**: both palette paths use Swift concurrency. #41's behavior stays: ranking off the main thread; out-of-date refreshes and rankings dropped. The GCD uses outside the palette predate the branch and are out of scope.
- S6 · Setup conditions checked with `#expect`: the parameterized Open-row test indexes `rows[1]` unrequired (`PaletteTests.swift`); two relay tests don't require the socket to bind (`RelayHistoryTests.swift`); swift-testing-pro: `#require` for preconditions · **fix**.
- S7 · `creation.done` is stored on every creation record but only its creator awaits it (`background.js` `openLil`; possible Speculative Generality) · **fix**.

## Spec

- P1 · #39 rule 4 "Open the `file://` URL for that absolute path": same defect as S2 · **fix** with S2.
- P2 · #41/#43 "Rows refresh when it lands": a refresh keeps a completion from the old history, even for a host the new snapshot lacks, and Return opens it (`PaletteController.swift` `refreshHistory`, `PaletteModel.swift` `rows(for:typedRows:)`) · **fix** · Settled (match Chrome): when a history refresh lands, the completion is worked out again from the new history; one the new history doesn't offer is dropped. Chrome re-applies the default match's completion whenever results change: `OmniboxEditModel::OnCurrentMatchChanged`, `chrome/browser/ui/omnibox/omnibox_edit_model.cc`.
- P3 · #44 "Tab opens the configured search engine's results for the typed text": same defect as S1 · **fix** with S1.
- P4 · #39 "the same answer in the palette and in the hoverbar address field": same defect as S4 · **fix** with S4.
- P5 · #39 out of scope "Inline completion (#38), ranking, and suggestions": choosing the hoverbar's Search row now always searches; on `main` it sent the text through the resolver, so `example.com` opened the site · **won't-fix** · Settled: the Search row searches, as its label says and as Chrome's search suggestion does.
