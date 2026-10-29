# Final Standards review — issue #15 (`ea58b515…18bed15`)

Axis only: documented repo standards + Fowler ch.3 baseline (judgement) + `/swift-testing-pro`. Not Spec.

**Verdict: clean.** No new hard documented-standard breach. No baseline smell worth filing.

## Documented standards

1. **AGENTS.md — three-component contract.** `docs/PROTOCOL.md` adds `open.priorContext` and `restore-focus`; `Messages.swift`, `OpenRouter`, and `RelayClient` send it; host `ExternalAppRestorer` / `handleRestoreFocus` receive it; the extension captures and restores; fixtures are in the shared list. Pinned IDs, slugs, sockets, and `config.json` are untouched.

2. **AGENTS.md — `@MainActor` / `verified:`.** New AppKit type `ExternalAppRestorer` is `@MainActor`. `OpenRouter.externalPriorContext` extends a type that already touched AppKit at the fixed point. No `verified:` comment was added or drifted (PID/bundle activation stays ledger P2 real-Mac QA).

3. **AGENTS.md — tests / prose.** `pnpm test` boots the production worker. Native coverage is contract/message tests. README/CHANGELOG untouched. Evidence under `.mayosdd/` is not product docs.

4. **PROTOCOL.md / CONTEXT.md.** `WINDOW_ID_NONE` is kept as external-focus state. Focused create is still `windows.create` then `focusWindow`. Geometry still never passes `focused`. API `type: "popup"` stays. Public/domain field remains `priorContext`; the internal candidate is `appSuppliedPriorContext` (ledger 3). Close consults then deregisters; host/group promote skips unwind via `promotingWindowIds`; a failed promote clears the mark (ledger 2).

## Ledger (not re-filed)

- **S1** won't-fix pending real-Mac QA — `onRemoved` still keys `wasFocused` off `focusedWindowId`; harness `windows.remove` still omits `onFocusChanged`.
- **S2** resolved — `appSuppliedPriorContext`.
- **P1** resolved — `promotingWindowIds` plus the host-tab assertion.
- **P2** won't-fix; manual seam.

## `/swift-testing-pro` — `mac/Tests/LilChromiumTests/MessageTests.swift`

Struct suite; `#expect` / `throws`; parameterized `everyPriorContextKindRoundTrips`; no `!` inside `#expect`; no XCTest; no extra `@Suite`. No findings.

## Baseline smells

None filed. Cross-language `PriorContext` encode is the contract, not Duplicated Code. Required three-component edits are not Shotgun Surgery.

## needs adjudication

None.

## Commands

- `git rev-parse` fixed point / HEAD → `ea58b515357bda113e3dd3b8738d4cd9fef09c93` / `18bed15c440fa57034507a1cdcfb128a445b293c`
- `git log ea58b515..HEAD --oneline` — `18bed15`, `54d81f9`, `4517c5a`, `a236e3a`
- `git diff ea58b515...HEAD --stat` — 19 files, non-empty
- `pnpm test` — 38/38 pass
- `swift test` in `mac/` — 127 tests, 12 suites, pass

Standards findings: 0. Worst issue: none.
