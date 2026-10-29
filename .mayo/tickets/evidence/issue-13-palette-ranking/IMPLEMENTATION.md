# Issue #13 — Make palette ranking deterministic

Branch: `v0.4/issue-13-palette-ranking` (based on `main` @ c2b692e)
Scope touched: `mac/` only. No change to `extension/` or `docs/PROTOCOL.md`.

## The ordering rule, in full

Given the palette's trimmed input text `Q` and a history snapshot:

1. **`Q` is empty** — the top 8 origins by frecency, no Search row. (Unchanged.)
2. **`Q` looks like a URL** (`URLIntent.looksLikeURL`: has a scheme, or has a dot
   and no spaces) — the rows are:
   1. `Open <Q>`
   2. `Search <engine> for "<Q>"`
   3. every history match, best-first
   No history row may sit above `Open` or between `Open` and `Search`.
3. **`Q` is non-empty and not URL-like** — a history result is **eligible for
   promotion** when the lowercased `Q` occurs as a **contiguous literal
   substring of that result's registrable domain**. The rows are:
   1. the single best eligible result, if any exists
   2. `Search <engine> for "<Q>"`
   3. every remaining history match, best-first
   With no eligible result, Search is row 1.

**Registrable domain** = public suffix + one label, computed from the host after
`www.` is stripped: the last two labels, extended to three when the last label is
a two-letter country code and the second-to-last is a public second-level label
(`co com net org ac edu gov ne or`). So `news.ycombinator.com` →
`ycombinator.com`, `shop.example.co.uk` → `example.co.uk`, `example.com` →
`example.com`. (`Ranking.registrableDomain`, Ranking.swift:422.)

**"Best"**, both for choosing the promoted row and for ordering everything below
Search, is the pre-existing ranking, now made a total order
(`Ranking.isBefore`, Ranking.swift:364), applied in this sequence:

- `score = matchTier × (frecency + 0.1)`, descending. Tiers are unchanged:
  host-prefix > host-contains > title-word-prefix > contains > fuzzy.
  `frecency = log10(1 + visits + 3·typed) × 0.5^(ageDays/30)`.
- then origins before pages,
- then the shorter title,
- then the smaller URL string.

Because the last step is a strict total order over distinct URLs, the row list is
a function of the history *content* alone — never of the order the browser
reported visits in, nor of dictionary iteration order.

**Fuzzy quality** (only reachable when no tier above it matched) is
`10 + quality × 90`, where `quality = density × (0.8 + 0.2 × boundaryFraction)`,
`density = n / span` over the matched characters' span and `boundaryFraction` is
the share of matched characters that follow a word boundary
(`Ranking.fuzzyDensity`, Ranking.swift:327). Density is 1.0 only for a fully
contiguous match — which the `contains` tier would already have caught — so a
scattered subsequence cannot reach the maximum however many of its characters
land on word boundaries.

### Checking any input by hand

1. Empty? → rule 1. URL-like? → rule 2. Otherwise rule 3.
2. Lowercase `Q`. For each history host, strip `www.`, take its registrable
   domain, and ask: is `Q` a contiguous substring of it? That set is the
   eligible set. Nothing else — not a subdomain label, not a title, not a path,
   not a query string, not a fuzzy match — can enter it.
3. The highest-scoring eligible result is row 1. Search is next. Everything else
   follows in score order.

## Acceptance criteria

> - [ ] For non-empty non-URL text, a contiguous literal match in the registrable domain may appear above Search.

Implemented as the promotion gate. `Ranking` reports
`RankedResult.matchesDomain` — `origin.domain.contains(query)` /
`page.domain.contains(query)` (Ranking.swift:88, 223, 239) — and `PaletteModel`
lifts the first such result above the Search row
(PaletteModel.swift:96-103). Covered by `registrableDomainPrefixLeadsSearch`
(PaletteTests.swift:145).

> - [ ] Literal registrable-domain prefix and interior matches are both eligible.

`contains` is used, not `hasPrefix`, so position inside the domain is irrelevant
(Ranking.swift:223,239). Covered by `registrableDomainPrefixLeadsSearch`
(PaletteTests.swift:145) and `registrableDomainInteriorMatchLeadsSearch`
("hub" → github.com, PaletteTests.swift:153).

> - [ ] A match only in a subdomain, title, path, query string, or unrelated URL text remains below Search.

The gate tests the registrable domain, which excludes subdomain labels by
construction (Ranking.swift:422), and never consults title/path/URL text. Such
results still rank and still appear — below Search. Covered by
`subdomainOnlyMatchStaysBelowSearch` (PaletteTests.swift:163),
`titleOnlyMatchStaysBelowSearch` (:173), `pathOnlyMatchStaysBelowSearch` (:184),
`queryStringOnlyMatchStaysBelowSearch` (:195), `unrelatedURLTextStaysBelowSearch`
(:203).

> - [ ] Fuzzy-only matches remain available below Search; a scattered subsequence cannot receive the maximum fuzzy quality.

Fuzzy remains the lowest tier and is still returned (Ranking.swift:327-355); the
old run/boundary bonus accumulator, which could clamp a scattered
boundary-aligned subsequence to the maximum, is replaced by a span-based density
penalty (Ranking.swift:351-352). Covered by `denseFuzzyMatchOutranksAScatteredOne`
(PaletteTests.swift:221), which asserts both fuzzy rows sit below Search and the
dense one precedes the scattered one. Verified red before the fix: the scattered
title ("Sunny Weather Update Info") previously scored the maximum and led.

> - [ ] When no eligible registrable-domain match exists, the configured Search action is first.

`PaletteModel.rows` appends the Search row unconditionally after the optional
promotion, so with no eligible result it is row 1 (PaletteModel.swift:96-103).
The engine comes from `searchEngine` (Startpage by default —
`SearchEngineConfig.defaults`); Google is not reintroduced anywhere. Covered by
`unmatchedTextLeadsWithSearch` (PaletteTests.swift:210) and by every
"stays below Search" case above.

> - [ ] Competing eligible domains use existing frecency signals as the tie-breaker.

Eligibility is a filter, not a score: the eligible set keeps its existing
`matchTier × frecency` order, so the first eligible result is the most frecent
one at the best tier (PaletteModel.swift:96). Covered by
`frecencyBreaksTiesBetweenEligibleDomains` (PaletteTests.swift:237) — two domains
matching "exa" at the same tier, the more frecent above Search and the other
below it.

> - [ ] URL-like input keeps an explicit Open action first and Search immediately after it.

The URL branch runs before the promotion branch and is exclusive with it, so no
history row can displace or interleave with Open/Search
(PaletteModel.swift:85-103). Covered by `urlInputKeepsOpenThenSearchAhead`
(PaletteTests.swift:278) — with a literal domain match in history for the same
site, Open still leads — and by the existing `urlInputLeadsWithAnOpenRow` (:55).

> - [ ] Duplicate host/path results and per-host limits remain deterministic.

Three ties that previously resolved by arrival order now resolve by content:
page dedupe on equal frecency keeps the smaller URL (Ranking.swift:147); origin
display-title selection on equal score keeps the smaller title
(Ranking.swift:164); and the result sort ends in a URL comparison, making it a
total order (Ranking.swift:364). Dedupe-by-URL and the 3-per-host cap then read a
fixed list. Covered by `duplicatesAndPerHostCapDoNotDependOnHistoryOrder`
(PaletteTests.swift:253), which builds the same history forwards and reversed and
demands identical rows; verified red by temporarily removing the URL tiebreak.

> - [ ] Native tests cover every specified ordering boundary and assert row/action order rather than internal scoring constants.

`PaletteOrderingTests` (PaletteTests.swift:108 onwards) is 12 tests, each
asserting a `[PaletteRow.Kind]` sequence and/or `actionURL` order. No test names
a tier value, a frecency number, or any other scoring constant. The pre-existing
`PaletteRowsTests` suite is unmodified and still passes.

## Ordering boundary cases tested

| Case | History | Query | Expected row order |
| --- | --- | --- | --- |
| Domain prefix | github.com | `git` | github.com, Search |
| Domain interior | github.com | `hub` | github.com, Search |
| Subdomain only | news.ycombinator.com | `news` | Search, news.ycombinator.com |
| Title only | github.com + a commit page titled "Fix gizmo alignment" | `gizmo` | Search, the commit page |
| Path only | example.com + example.com/pricing | `pricing` | Search, example.com/pricing |
| Query string only | example.com/s?q=telescope | `telescope` | Search, that page |
| Unrelated URL text | example.com/blog/https-primer | `https-primer` | Search, that page |
| No match at all | github.com | `quarterly review` | Search (only row) |
| Fuzzy dense vs scattered | example.com + "SwiftUI Basics" + "Sunny Weather Update Info" | `swui` | Search, SwiftUI Basics, Sunny Weather Update Info |
| Competing eligible domains | examples.org (2 visits), example.com (90 visits, 30 typed) | `exa` | example.com, Search, examples.org |
| Duplicates + per-host cap | example.com/a, www.example.com/a, /b, /c, /d, all tied | `example` | example.com, Search, example.com/a, example.com/b — identical for reversed history |
| URL-like input | example.com (high frecency) | `example.com/pricing` | Open example.com/pricing, Search, … |

## Verification

`swift test` in `mac/` — final output (per-suite result lines and the run
summary; the per-test lines are elided for length):

```
􁁛  Suite SearchProviderTests passed after 0.007 seconds.
􁁛  Suite URLIntentTests passed after 0.008 seconds.
􁁛  Suite ConfigDecodingTests passed after 0.007 seconds.
􁁛  Suite BrowserCatalogTests passed after 0.007 seconds.
􁁛  Suite RoutingOrderTests passed after 0.008 seconds.
􁁛  Suite ConfigMergeTests passed after 0.007 seconds.
􁁛  Suite MessageTests passed after 0.007 seconds.
􁁛  Suite PaletteOrderingTests passed after 0.008 seconds.
􁁛  Suite TintTests passed after 0.008 seconds.
􁁛  Suite PaletteRowsTests passed after 0.007 seconds.
􁁛  Suite BrowserTableTests passed after 0.008 seconds.
􁁛  Suite NativeHostManifestTests passed after 0.101 seconds.
􁁛  Test run with 119 tests in 12 suites passed after 0.101 seconds.
```

`pnpm test` — final output:

```
✔ suite runs without a live profile or the repo as cwd (1.043667ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 679.1865
```

## Deliberately not done

- **No Public Suffix List.** `registrableDomain` is a ~10-line rule, not a
  bundled PSL. It is right for `example.com`, `news.ycombinator.com`, and
  `example.co.uk`; it is wrong for hosts under a *delegated* public suffix such
  as `user.github.io`, where it treats `github.io` as the registrable domain and
  therefore leaves `user` below Search. That is the safe direction to be wrong
  in (a query demotes to search rather than hijacking it), and shipping the PSL
  for it would be far out of proportion to the ticket.
- **No change to `extension/` or `docs/PROTOCOL.md`.** PROTOCOL.md's hoverbar
  omnibox note still describes the v0.2 tier ranking it ports. The palette's
  above/below-Search ordering is a native ranking concern, not a wire contract,
  so nothing here spans the three components; per the ticket's constraint, no
  contract change was made.
- **No shared-fixture edits.** `fixtures/message-history-result.json` is read by
  the Node suite too. The ordering cases are built inline in Swift instead, where
  each test states exactly the site shape it exercises.
- **`PaletteModel.autocompleteHost(for:)` left alone.** It returns the top ranked
  host regardless of prefix and relies on its caller
  (`PaletteController.applyAutocomplete`) to apply the prefix guard. That is
  pre-existing and outside this ticket's criteria, so it was not refactored.
- **Match tiers untouched.** Promotion is a gate, not a new score, so no tier
  value moved; only the fuzzy tier's internal quality function changed, as the
  fuzzy criterion required.
