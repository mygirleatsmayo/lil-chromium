# Issue #41 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `3aa5666`

## Standards

- S1 · A rejected `chrome.history.search` replies like a successful empty search, and the palette installs the empty index (PROTOCOL.md: keep the snapshot on failure) · **fix**: same defect as P1; one fix.
- S2 · The reply reader checks the accumulated size before reading, then appends the last chunk unchecked, so it can exceed the documented 64 MiB cap · **fix**: check the payload length before appending.
- S3 · `autocompleteHost(for:rows:)` falls back to a second `Ranking.rank(…, limit: 1)` when row 0 is Search or Open (possible Duplicated Code) · **fix**: keep the top history match from the one ranking pass.
- S4 · `chunk.firstIndex(of: 0x0A)` adds a second newline parser beside `LineBuffer` (possible Duplicated Code) · **fix**: reuse the shared parser, scanning only incoming bytes, with the reply cap.
- S5 · `connectTimeoutMs`/`readTimeoutSec` parameters no caller overrides; `readTimeoutSec` also changes the write timeout (possible Speculative Generality, Mysterious Name) · **fix**: keep the longer read timeout local to the history call; keep the existing write timeout.

## Spec

- P1 · "A refresh that fails or times out keeps the previous snapshot instead of emptying the palette" · **fix** · Settled: a failed browser history search, and a host with no extension connected, reach the app as a failure, never as an empty success. The app keeps the previous snapshot on any failure. A genuinely empty history still empties the palette. Contract change: PROTOCOL.md, the shared fixtures, app, host and extension in step.
- P2 · "it runs off the main thread with out-of-date results dropped": Return and ↑/↓ settle a pending ranking on the main thread · **won't-fix** · Settled: the off-main requirement covers typing. Return and ↑/↓ must act on rows for the current text, so waiting for a pending ranking (at most one ranking's time) is correct.
- P3 · An older refresh that finishes last overwrites a newer snapshot · **fix** · Settled: only the newest refresh may install its snapshot.
- P4 · The `pong` reply cap rose from 8 MiB to 64 MiB with the shared reader (scope creep) · **fix**: the larger cap applies to history replies only (pairs with S5).
- P5 · "The PR states the measured time" · **integration obligation, not code**: the PR to `main` states ~91 ms mean / 137 ms worst per keystroke at 20,000 items (release, M4 Pro), run off the main thread.

## Remediation 1

- S4 residual · The cap check runs `chunk.firstIndex(of: 0x0A)` over the same bytes `lineBuffer.append(chunk)` scans · **fix** (S4 not yet met): one delimiter scan per chunk; the cap check uses what the shared scan reports. Amends S2: buffering at most one read chunk past the cap before rejecting is fine; a reply line over the cap is never accepted.
- N1 · Inserting `PaletteResults` moved the doc lines "The only modifier keys that participate in a palette Return chord" onto the wrong type · **fix**: put them back above `PaletteReturnChord`.
- C1 · No test covers the reply cap boundary (the implementer noted a real-size test needs a reply over 64 MiB) · **fix**: one focused test at a small cap: a line exactly at the cap is accepted, one byte over is rejected.

## Remediation 2

- N2 · `#expect(socketpair(...) == 0)` lets the cap test continue when the socket pair fails; both descriptors start at `0`, so the test can write to and close the runner's stdin · **fix**: `try #require` the socket pair before touching either descriptor.

## Final review 1

### Standards

- S6 · A click on a row still showing the previous query's results acts on it: type `settings`, delete the last `s`, click the Settings row before ranking lands, and Settings opens (PROTOCOL.md: a selectable Settings result for the complete words only) · **won't-fix** · Settled (extends P2): a click acts on the row on screen, the row the user aimed at; settling first would put a different row under the pointer. The PROTOCOL rule governs which queries produce the Settings row, and they still do. Return and ↑/↓ act on rows for the current text (P2).
- S7 · `historyQuery` accepts any decodable reply without matching `id` or `type` (PROTOCOL.md: `id` for request/response matching) · **won't-fix**: predates #41 (`bf45a2f` decoded the reply the same way); each app request has its own connection, and the host does the `id` matching.
- S8 · No runnable check for out-of-date handling; the relay failure test accepts any error, so a timeout passes (global rules: non-trivial logic leaves one runnable check) · **fix**: one focused test each: an older refresh landing after a newer one leaves the newer snapshot (P3); a ranking for an older query landing after a newer edit is not rendered ("out-of-date results dropped"). The failure test asserts the reported-failure error.
- S9 · `autocompleteHost(for:)` is now a test-only forwarder to `results(for:)` (possible Middle Man) · **fix**: tests read `results(for:).autocompleteHost`; remove the forwarder.
- S10 · The host repeats lock / `removeValue(forKey: id)` / unlock in forwarding failure and reply delivery (possible Duplicated Code) · **fix**: one atomic take of a pending query, used by both.
- S11 · `RelayError.readTimeout` also covers EOF and an over-cap reply (possible Mysterious Name) · **fix**: a name that covers any missing or rejected reply line.

### Spec

- P1 (again) · "A refresh that fails or times out keeps the previous snapshot": a Primary failure falls through to the next routed socket, and a real empty history from that browser empties the palette · **won't-fix** · Settled (amends P1): a refresh fails when no routed socket returns real history. PROTOCOL.md's routing order (steps 1–3) decides which browser's history the palette shows, as before #41; a real reply from the next routed browser is a successful refresh, even when empty.
- P6 · "it runs off the main thread with out-of-date results dropped": a caret move leaves the ranking generation unchanged; type `git`, press ← while ranking is pending, and the completion still rewrites the field and replaces the caret with a selected suffix · **fix** · Settled: a completion applies only to the field state it was ranked for (same text, caret at the end, no selection); any edit, caret move or selection change since drops the completion. The rows still render, since they depend on the text alone.
- P5 (again) · integration obligation, as above.

### Caller

- C2 · `PaletteModel.setIndex(_:)` is now called only from tests; the app installs through `install(_:from:)` (raised by the implementer; same kind as S9) · **fix**: tests install through the app's path; remove `setIndex`.

## Remediation 4

- P6 residual · `completionApplies(… selection: editor.selectedRange)` checks only the final field state; type `git`, press ← then → before ranking lands, and the completion still applies · **won't-fix** · Settled (amends P6): the test is the field state, not its history. The rule exists so a completion never overrides a caret or selection the user set; a caret back at the end with nothing selected is the state the completion was ranked for, so applying it overrides nothing. P6 is resolved on this basis.
- S8 residual · The ranking test asserts only `#expect(!model.isCurrent(older))`; it still passes if the controller renders a stale ranking · **fix** (S8 not yet met): the gate that decides whether a ranking's rows render lives where the test exercises it (as `install(_:from:)` does for refreshes), so the test fails if a stale ranking renders.
- S11 residual · `ping` still throws `.noReplyLine` when a line arrives but `decodeLine(PongMessage.self, …)` fails · **fix** (S11 not yet met): a line that arrives but does not decode throws `.decodeFailed` on `ping`, as on history; `.noReplyLine` means no usable line was read.

## Review status

- Full review 1: 5 Standards (all fix), 5 Spec (P1, P3, P4 fix; P2 won't-fix; P5 at PR time).
- Remediation 1 (`3aa5666...a6d1d34`): S1/P1, S2, S3, S5, P3, P4 resolved; S4 unresolved (fix); 1 new defect (N1, fix); caller item C1 (fix).
- Remediation 2 (`a6d1d34...4149555`): S4 residual, N1, C1 resolved; 1 new defect (N2, fix).
- Remediation 3 (`4149555...52e16bb`): N2 resolved, no new defects. Ledger resolved; final full review next.
- Final review 1 (`bf45a2f...103b92e`): Standards S8–S11 fix; S6, S7 won't-fix. Spec P6 fix; P1 (again) settled won't-fix; P5 at PR time.
- Remediation 4 (`bb01d2c...d73fb10`): S9, S10, C2 resolved; P6 residual adjudicated won't-fix (P6 resolved); S8, S11 unresolved (fix); no new defects.
- Remediation 5 (`d73fb10...9d12da7`): S8, S11 residuals resolved, no new defects. Ledger resolved; ready to integrate once mygirleatsmayo approves the merge flow (P5 at PR time).
