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

## Review status

- Full review 1: 5 Standards (all fix), 5 Spec (P1, P3, P4 fix; P2 won't-fix; P5 at PR time).
- Remediation 1 (`3aa5666...a6d1d34`): S1/P1, S2, S3, S5, P3, P4 resolved; S4 unresolved (fix); 1 new defect (N1, fix); caller item C1 (fix).
