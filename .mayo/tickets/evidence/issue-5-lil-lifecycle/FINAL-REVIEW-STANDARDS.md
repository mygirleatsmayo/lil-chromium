# Final standards review — issue #5 (`c2b692e...b209517`)

Axis only: documented repo standards + Fowler ch.3 baseline (always judgement). Not spec.

**Verdict:** no new findings. No hard documented-standard breach. No baseline smell worth filing.

## Method

Read `AGENTS.md`, `docs/PROTOCOL.md`, `CONTEXT.md`, `docs/adr/0001`–`0003`, `docs/agents/domain.md`, and the frozen ledger. Walked `git diff c2b692e...b209517` (`28ce689`, `48186e6`, `88b8fce`, `a7747a3`, `b209517`) and post-fix `openLil` / adapters / new tests at `b209517`. Confirmed a single lil `windows.create` and a single `registerWindow(` call, both inside `openLil`; promote-fallback `windows.create` still builds a normal window.

## Documented standards — no hard breaches

1. **AGENTS.md — three-component contract.** Diff is `extension/` + `.mayosdd/` evidence. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. `docs/PROTOCOL.md` and `mac/` untouched — correct; no contract change.
2. **AGENTS.md — `@MainActor` / `verified:`.** No Swift. No `verified:` comments in the hunks; none to keep accurate. macOS focus unreliability still cites `research §Focus`, not a new on-box claim.
3. **AGENTS.md — tests / prose.** New tests boot the production service worker via `boot()`; fixtures stay at repo-root `fixtures/`. Lucas-facing copy untouched. Evidence is not product docs.
4. **PROTOCOL.md Focus discipline.** User-initiated creates still `windows.create` then `focusWindow`. Restore `focus: false` is ledger interpretation 1.
5. **CONTEXT.md / domain.md.** `type: "popup"` stays Chromium API (interpretation 3). Wire `sleep*` kept: PROTOCOL overrides **Lil Nap**. New test prose says “napping lil” / “incognito lil”. `openLittleWindow` → `openLil`.
6. **ADR 0001 / 0002 / 0003.** No Settings surface, no profile routing. ADR 0003 named out of scope in `IMPLEMENTATION.md`, not silently overridden.

## Ledger (not re-filed)

- **S1** resolved — create/focus comments name the restore exception (`background.js:253-255`, `:287`).
- **S2** resolved — `spec.recordUrl`, `unpositionedCoord`. `openIncognitoLil`’s `fallback` left as remediation stated.
- **S3** resolved — “offset lil”; “incognito lil”. `secret.type === "popup"` stays.
- **S4** won't-fix (interpretation 2) — dual URL guard remains.
- Interpretation 4 — `registerWindow` `prev` merge left in place.

## Baseline smells

None filed. `cascadeTabToLil` / `sendTabToLil` look like Middle Man / near-duplication; the change’s design is named entry-path adapters over one `openLil` boundary, so the baseline is suppressed. `spec.size` / `spec.focus` / `spec.registration` encode real path differences, not Speculative Generality. S4 duplication suppressed by the ledger.

## needs adjudication

None.
