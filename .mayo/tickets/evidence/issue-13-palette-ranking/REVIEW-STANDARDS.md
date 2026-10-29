# Standards review — Issue #13 (palette ranking)

Axis: documented repo standards + Fowler ch.3 baseline. Method: `git diff main...v0.4/issue-13-palette-ranking` (4 files, 4 commits) read against `AGENTS.md`, `docs/PROTOCOL.md`, `CONTEXT.md`, `docs/adr/0001`–`0003`.

## Documented standards — no hard breaches

1. **AGENTS.md — three-component contract.** Diff is `mac/` + evidence only. No messages, `config.json`, sockets, slugs, routing, or pinned IDs. Leaving `extension/` and `docs/PROTOCOL.md` untouched is correct.
2. **AGENTS.md — `@MainActor` / `verified:`.** No new AppKit type. `PaletteModel` stays Foundation-only (`PaletteController` already `@MainActor`). No new API/OS claim; no `verified:` comment drifted.
3. **AGENTS.md — tests / prose.** Palette behavior tests land in `PaletteTests.swift` (`PaletteOrderingTests`). No Lucas-facing copy overwritten. Evidence is under `.mayosdd/`, not the repo root.
4. **PROTOCOL.md.** Search row still uses `searchEngine`. URL-like input still leads with Open, then Search. Ranking still host-prefix > title-word-prefix > contains > dense fuzzy × frecency, host+path dedupe, ≤3/host. Hover-bar “port v0.2 palette ranking” is the extension omnibox contract; this diff does not rewrite it.
5. **CONTEXT.md.** No avoided synonyms (popup, default browser, connected browser, sleep, etc.).
6. **ADR-0001 / 0002 / 0003.** No Settings surface, no profile routing, no prior-context restore.

## Baseline smells (judgement only)

Repo standards override the baseline. Tooling (Swift 6 isolation) already covers `@MainActor` on AppKit types.

1. **J1 — Mysterious Name** — `mac/Sources/LilChromiumApp/Ranking.swift` (`RankedResult.matchesDomain`, `IndexedPage.domain`, `Origin.domain`). The gate is “query is a contiguous literal substring of the *registrable* domain,” not host or subdomain. The names read as a generic domain match — the distinction this change exists to enforce.

```
let domain: String      // registrable domain of `host`
let matchesDomain: Bool
matchesDomain: origin.domain.contains(query)
matchesDomain: page.domain.contains(query)
```

Not a documented naming rule, so not hard.

2. **J2 — Duplicated Code** — same two `RankedResult` construction hunks: `*.domain.contains(query)` is written for origins and again for pages. A later edit can desync the promotion flag. Both loops already built `RankedResult` in parallel; extracting a one-line helper is optional.

Suppressed: Primitive Obsession on `String` hosts/domains — PROTOCOL and this tree use strings for hosts and slugs.

## Checked, not filed

`registrableDomain` + `publicSecondLevelLabels` implement the registrable-domain rule (incl. `co.uk`); not Speculative Generality. `isBefore` is a total order used at two sort sites, not a Middle Man. Ranking + `PaletteModel` row composition + tests is one cluster, not Shotgun Surgery. Empty-query `matchesDomain: false` is the struct’s required field.
