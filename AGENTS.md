# AGENTS.md

lil chromium: a macOS menu-bar agent (the system default browser) that opens links as **lils** — ephemeral popup windows of the user's real Chromium browser. Three components, one contract: `mac/` (Swift package: LilChromiumApp agent + lilchromium-host relay), `extension/` (MV3, loaded unpacked, no build step), `docs/PROTOCOL.md` (the contract).

- Read `docs/PROTOCOL.md` before touching messages, `config.json`, relay sockets, browser slugs, routing order, or the pinned IDs (extension ID, host name, bundle ID). A contract change lands in all three components or none.
- Source of truth: the `main` worktree owns `docs/`, `.mayo/`, `GLOSSARY.md`, and this `AGENTS.md`; land them on `main` too, never only on a trial or release worktree.
- Annotate AppKit-touching classes `@MainActor`. The Swift 6.4 toolchain (Xcode beta) makes isolation violations hard errors even in Swift 5 mode.
- Mark API/OS behavior you have confirmed on a real system with a `verified:` comment; keep existing ones accurate when changing the code they describe.
- Validate with `swift test` in `mac/` (behavior tests for config, messages, routing, URL intent, and the palette) and `pnpm test` (extension suite: production service worker in Node, no browser). Fixtures live in the repo-root `fixtures/`, shared by both suites. `make app` is the release build. `make install` goes further: it replaces the live app in /Applications and rewrites every browser's native-host manifest.
- Write JavaScript for maintained Node only; `engines.node` in `package.json` is the floor. When code needs an API above the floor, raise the floor if every release below that API is end of life; else ask mygirleatsmayo.
- `version_name` in `extension/manifest.json` is the extension build that the hoverbar's caret menu shows, and nothing generates it. Every PR that changes `extension/` updates it, with a new `version` or a descriptive PR slug (`0.4.2-palette-hoverbar`), so a live check can tell which build runs.
- Never overwrite mygirleatsmayo's human-facing prose.

## mayo SDLC

This project uses the mayo dev workflow. 

### Issue tracker

See `.mayo/agents/issue-tracker.md`.

### Triage labels

See `.mayo/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `.mayo/adr/` at the repo root. See `.mayo/agents/domain.md`.
