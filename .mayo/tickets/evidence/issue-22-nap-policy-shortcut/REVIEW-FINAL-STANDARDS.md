# Final Standards review — issue #22

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` and head `2e8185ea3cb574c068bc300407340b04558ffcc7` both resolve; `git diff` is non-empty.

Commits: `8549172 feat(nap): preserve Lil Nap policy and add an unassigned shortcut`; `2e8185e docs(review): record issue 22 initial review`.

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, smell baseline. Product delta: `docs/PROTOCOL.md`, `extension/manifest.json`, `extension/background.js`, plus tests/harness. Evidence Markdown is audit context only.

Ledger (round 1, settled, final): no Standards/Spec findings; no remediation owed. No settled interpretation is disputed.

## Documented standards (hard)

No breaches.

- **`AGENTS.md` / `PROTOCOL.md` three-component rule.** Extension-only: unassigned `let-this-lil-nap`, overlay keys stay non-commands, manual Nap while `sleep.enabled` is false. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. Matches PROTOCOL’s existing extension-only pattern (issue #18). `mac/` untouched. *(ledger-consistent)*
- **`CONTEXT.md` language.** Command description is “Let This Lil Nap”. Internal `sleepLil` / `sleep` stay PROTOCOL’s legacy identifiers; no new user-facing “sleep” copy.
- **`AGENTS.md` AppKit `@MainActor` / `verified:`.** No Swift or OS-behavior edits.
- **Lucas’s prose.** PROTOCOL bullets extended; not rewritten.

## Baseline smells (judgement)

No genuine smells in production hunks.

`onCommand` shares one focused-lil query, then:

```
if (command === "promote-tab") { await promoteTab(...); return; }
if (command === "let-this-lil-nap") { await sleepLil(tab.windowId); }
```

Two arms is not Repeated Switches. Both manual paths call existing `sleepLil` (Duplicated Code: no). Manifest omits `suggested_key` as PROTOCOL requires. Test helpers (`applySleepConfig`, `parkIdle`, `lilTab`, `env.command`) collapse setup.

PROTOCOL’s “via the shared `throttledCapture` path” names a pre-existing worker function; not a new abstraction (Speculative Generality: no). *(ledger-consistent)*

## Severity

None. Cohesive extension+contract change; no shotgun/divergent-change, speculative hooks, or names that hide behavior.
