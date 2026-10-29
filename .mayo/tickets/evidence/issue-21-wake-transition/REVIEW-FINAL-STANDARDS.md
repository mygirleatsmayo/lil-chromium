# Final Standards review — issue #21

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` … head `95fecc235812d27796e3b32bacce40bf79da4724` (both resolve; branch diff non-empty). HEAD judged; issue #21 commits only (`1b2673b`, `5561c6c`, `f1354d8`, `f8c9ce8`, `9ae96ee`). Overlay/manifest/other-ticket PROTOCOL hunks ignored.

Sources: `AGENTS.md`, `CLAUDE.md`, `/chrome-extension` v1.1.0 (`~/projects/lil-chromium/.agents/skills/chrome-extension/`; this worktree has no copy) and routed refs `service-worker.md`, `messaging-rpc.md`, `debugging-mistakes.md`, `storage.md`, `web-accessible-resources.md`, `permissions.md`, `content-scripts.md`, `execution-contexts.md`; smell baseline. Ledger S1–S3, P1–P5, F1–F5, O1–O2, A1 are final.

## Documented standards (hard)

None.

Checked: PROTOCOL Lil Nap wake and HEAD `wakeLil` / `waitForWakeSwap` / `sleep.js` `leaveNap` agree (inactive same-window preload, 180/500 bounds, subscribe-then-inspect, truthful activation vs removal failure, bounded page cleanup, 1000 ms unreachability). Extension-only: no new messages, `config.json`, sockets, slugs, routing, or pinned IDs (`AGENTS.md`). `mac/` untouched. `wakeLil` handler is the existing non-async wrapper with literal `return true` (`messaging-rpc.md` §2; `background.js` ~2008–2034). Floor/cap `setTimeout`s are 180–500 ms (`service-worker.md` §1; SKILL.md: not > few seconds). Top-level `tabs.onUpdated` remains; `waitForWakeSwap`’s extra listener is the in-flight P3 waiter, not a missed SW wake registration. Page cleanup uses `storage.local` with a 150 ms bound vs IPC (`storage.md`; `debugging-mistakes.md` §5–6; harness `STORAGE_LATENCY_MS = 20`). No new permissions; `executeScript({ func })` not `code` (`permissions.md`; `debugging-mistakes.md` §4.10). Internal `sleep*` names kept; README/CHANGELOG untouched (Lucas’s prose). No AppKit / `@MainActor` / `verified:` edits.

Settled, not reopened: F2 evidence-gated inject; F4 placement; F5 `tabs.get`; O1 WAR/`u`; O2 idempotent `clearNapState`.

## Baseline smells (judgement)

None that are a concrete risk.

S1/S2 remain resolved: `wakeFloorRemainingMs` is the one floor helper; `createClock` stays private and fixed-start.

Not filed: `sleep.js` `idbDelete` vs worker `idbDelete` — same store, separate contexts; page comments that there is no shared module (unpacked, no build — `AGENTS.md`). Page vs worker clocks share a timer-queue shape but are not the same type (Date vs not; epoch vs 0); extracting a shared clock would reopen S2 speculative API. `background.js` still hosts tab behavior (pre-existing, not new Divergent Change).

## Severity

None. Cohesive worker+page+PROTOCOL wake; ledger fixes hold; no three-component or chrome-extension hard miss.
