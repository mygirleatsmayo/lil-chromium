# Standards review — issue #22

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` … head `85491720bfcf14823256b5937b600f3f7d21f1b4` (both resolve; `git diff` non-empty). One commit: `feat(nap): preserve Lil Nap policy and add an unassigned shortcut`.

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, plus the smell baseline. Production hunks: `docs/PROTOCOL.md`, `extension/manifest.json`, `extension/background.js`. Tests/harness only as supporting context.

## Documented standards (hard)

No breaches.

- **`AGENTS.md` / `PROTOCOL.md` three-component rule.** Delta is extension-only (MV3 command, overlay-key non-remap, manual Nap while `sleep.enabled` is false). No messages, `config.json`, sockets, slugs, routing, or pinned IDs. Same “extension-only, no app/host change” pattern PROTOCOL already uses for attributable new-tab conversion. `mac/` correctly untouched.
- **`CONTEXT.md` language.** User-facing command description is “Let This Lil Nap”. Internal `sleepLil` / `sleep` remain PROTOCOL’s named legacy identifiers; this diff does not introduce new user-facing “sleep” copy.
- **`AGENTS.md` AppKit `@MainActor` / `verified:`.** No Swift or OS-behavior edits.
- **Lucas’s prose.** PROTOCOL bullets were extended, not rewritten into different product language.

## Baseline smells (judgement)

No genuine smells in the production hunks.

`onCommand` now shares one focused-lil query, then branches:

```
if (command === "promote-tab") { await promoteTab(...); return; }
if (command === "let-this-lil-nap") { await sleepLil(tab.windowId); }
```

Two arms is not Repeated Switches. Both manual paths call existing `sleepLil` (not duplicated capture/registry logic). Manifest omits `suggested_key` as PROTOCOL requires. Test helpers (`applySleepConfig`, `parkIdle`, `lilTab`, `env.command`) collapse setup rather than copy it.

PROTOCOL’s new phrase “via the shared `throttledCapture` path” names a worker-private function. That is contract wording, not a code smell; the function itself is pre-existing and unused as a new abstraction.

## Severity

None. Small, cohesive extension+contract change; no shotgun/divergent-change, speculative hooks, or naming that hides behavior.
