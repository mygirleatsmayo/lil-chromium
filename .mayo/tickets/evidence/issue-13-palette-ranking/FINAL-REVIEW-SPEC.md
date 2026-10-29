# Final spec review — issue #13 (palette ranking)

Range `c2b692e...8bac542`. Contract: issue #13 ACs. Ledger D1/D2 and interpretations 1–7 are final.

**Verdict:** No spec findings. The diff implements the ticket.

## Findings by severity

None.

**(a) Missing or partial:** none. **(b) Scope creep:** none user-facing (NA1 type-ahead is interpretation 7; empty-query `isBefore` is interpretation 2). Production delta: `PaletteModel.swift` + `Ranking.swift`. **(c) Implemented but wrong:** none. SP1/SP2/SP4/D1/NA1 hold at `8bac542`. SP3 stays unfixed per D2.

## What was checked

`gh issue view 13` (nine ACs) and `2` (stories 29–34). Diff plus `rows(for:)`, `bestEligibleIndex`, `queryMatchesRegistrableLabel`, `fuzzyDensity`, `autocompleteHost(for:)` at `8bac542`. Implementer markdown as claims. `swift test --filter Palette` at `8bac542` (25 pass). Probed untested inputs on that model: D2 `user.github.io`/`user`, herokuapp/`myapp`, `co` vs `example.co.uk`, `ycombinator`, fragment, scheme, recency, title-only, empty-history URL.

1. **“a contiguous literal match in the registrable domain may appear above Search.”** One `matchesRegistrableLabel` row is lifted; else Search leads. D1: label only — `com`/`co` do not promote; `git`/`example` do.
2. **“Prefix and interior matches are both eligible.”** `registrableLabel.contains(query)` (`git`/`hub`; `example` on `example.co.uk`).
3. **“A match only in a subdomain, title, path, query string, or unrelated URL text remains below Search.”** Gate ignores those fields. Tests plus fragment/scheme probes stay Search-first.
4. **“Fuzzy-only matches remain available below Search; a scattered subsequence cannot receive the maximum fuzzy quality.”** Lowest tier, still returned. `density = n/span` is 1.0 only when contiguous (already `contains`).
5. **“When no eligible … match exists, the configured Search action is first.”** Search follows optional promotion. Rank uses the full set (SP2); display clips after. Eligible implies `host.contains`.
6. **“Competing eligible domains use existing frecency signals as the tie-breaker.”** Raw `frecency`, not tier (SP1). `isBefore` only on equal frecency.
7. **“URL-like input keeps an explicit Open action first and Search immediately after it.”** Exclusive of promotion.
8. **“Duplicate host/path results and per-host limits remain deterministic.”** URL/title tie-breaks + total order; reversed history matches.
9. **“Native tests cover every specified ordering boundary and assert row/action order rather than internal scoring constants.”** Prefix, interior, subdomain, title, path, query, unrelated URL, novel text, dense vs scattered fuzzy, same- and cross-tier frecency, budget eviction, TLD vs label, duplicates/per-host, URL-like, promoted type-ahead. Kinds/`actionURL`/`host` only. Return modifiers are #2, not this ticket. D2 `user.github.io`+`user` is untested in-tree; probe matches D2.

Interpretation 7: when row 0 is `.history`, `autocompleteHost` returns that host. Ghost still requires a host prefix, so an interior promotion paints no ghost rather than the wrong host.
