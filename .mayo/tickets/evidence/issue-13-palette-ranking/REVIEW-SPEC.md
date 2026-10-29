# Spec review — issue #13

Spec: `gh issue view 13`. Diff: `main...v0.4/issue-13-palette-ranking`. `IMPLEMENTATION.md` is a claim, not evidence.

## High — implemented, but wrong

> Competing eligible domains use existing frecency signals as the tie-breaker.

> For non-empty non-URL text, a contiguous literal match in the registrable domain may appear above Search.

> When no eligible registrable-domain match exists, the configured Search action is first.

Promotion is `matches.firstIndex(where: \.matchesDomain)` on `Ranking.rank(..., limit: 7)` — already tier×frecency sorted and per-host capped. `domain.contains(query)` implies `host.contains(query)`, so eligible ≤ host-contains (400). Ineligible subdomain prefixes (`hub.docker.com` + `hub`) are host-prefix (1000).

1. Two eligible domains: a prefix match beats a more-frecent interior match (`hubspot.com` vs `github.com` for `hub`). Tie-break is tier, not frecency.
2. Ineligible host-prefix rows can fill the budget and drop the eligible row, so Search leads while history still has an eligible match.

Frecency test is same-tier only (`exa` × example.com / examples.org).

## Medium — partial / wrong

> A match only in a subdomain … remains below Search.

> … a contiguous literal match in the registrable domain may appear above Search.

`registrableDomain` is last-two labels, or three for a 2-letter TLD plus a 9-word SLD list — not eTLD+1. `user.github.io` + `user` stays below Search (treated as a subdomain of `github.io`) even though the registrable domain is `user.github.io`. Same miss for herokuapp / appspot. IMPLEMENTATION.md calls this deliberate; it still fails the named rule.

## Low — tests

> Native tests cover every specified ordering boundary and assert row/action order rather than internal scoring constants.

Twelve tests cover the happy-path boundaries. They miss the High/Medium inputs. Fuzzy “cannot receive the maximum” is inferred from dense-before-scattered order.

## (b) Scope creep

No extra policy. Empty-query `topByFrecency` now uses the total-order comparator. #13 did not mention the empty list; it is a side effect of the duplicate/per-host determinism AC. URL ties in page-dedupe / origin-title / sort are in scope for that AC.

## Checked, no defect

Prefix and interior both use `contains` on the registrable domain. Title / path / query / unrelated URL stay below Search when not also in the eTLD+1. Fuzzy still appears below Search; span density `n/span` is 1.0 only for a contiguous match, already taken by `contains`, so a scattered subsequence cannot hit `fuzzyMax`. URL-like is exclusive of promotion: Open, then Search. Native-only. Assertions use row kind / `actionURL`, not tier constants.
