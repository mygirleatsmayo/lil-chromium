# Findings ledger — issue #13 (make palette ranking deterministic)

Fixed point: `main` (`c2b692e`) · Branch: `v0.4/issue-13-palette-ranking`
Review round 1 (full, two-axis): Standards `9HgmDIK_`, Spec `qn9UX3g9`, both cursor-grok-4.6-xhigh.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Manager verification

I re-ran `swift test` (119 pass, 12 suites) and confirmed the diff is confined to `mac/` plus evidence. I hand-verified both High spec findings in the source before accepting them — `PaletteModel.swift:83` ranks with `limit: budget` and `:96` then picks `firstIndex(where: \.matchesDomain)`, which is exactly the ordering the reviewer describes. Both findings are real.

## Owner decisions (Lucas, this session) — binding

**D1. No TLD matching.** The eligibility test matches the query against the **distinctive label only**, not the label plus public suffix. `com` must not promote every `.com` site above Search; `git` must still promote `github.com`; `example` must still promote `example.co.uk`. This settles the ambiguity in criterion 1 that the implementer flagged rather than guessing.

**D2. The approximate registrable-domain rule is accepted for v0.4.** `registrableDomain` stays last-two-labels plus the country-code rule. `user.github.io`, herokuapp, and appspot queries demote to Search. No public suffix list is bundled. This overrides spec finding SP3 below — it is a knowingly accepted deviation, not an open defect.

## Findings

| ID | Location | Verdict | Reasoning |
|---|---|---|---|
| SP1 | `PaletteModel.swift:96` — `firstIndex(where: \.matchesDomain)` over a tier-sorted list | **fix** | Criterion 6: "Competing eligible domains use existing frecency signals as the tie-breaker." Among two eligible domains, tier decides, not frecency — a prefix match beats a far more frecent interior match. Verified in source. |
| SP2 | `PaletteModel.swift:83` — `Ranking.rank(..., limit: budget)` before eligibility is applied | **fix** | Criterion 5: Search leads only "when no eligible registrable-domain match exists." Ineligible higher-tier rows (subdomain prefixes) can fill the budget and evict the eligible row, so Search leads while history still holds an eligible match. Eligibility must be resolved before the row budget is spent. Verified in source. |
| SP3 | `registrableDomain` is not a true eTLD+1 | **won't-fix** | Overridden by owner decision D2. Accepted limitation for v0.4. Keep it documented in code. |
| SP4 | `PaletteOrderingTests` misses the SP1 and SP2 inputs | **fix** | Criterion 9 requires coverage of "every specified ordering boundary." Add cases for the two-eligible-domains tie-break and for eligible-row-evicted-by-ineligible-rows. Assert row/action order only — no scoring constants. |
| J1 | `Ranking.swift` — `RankedResult.matchesDomain`, `IndexedPage.domain`, `Origin.domain` | **fix** | Mysterious Name. The names read as generic domain matching when the rule is specifically about the registrable domain's label. This is the exact distinction the ticket exists to enforce, and D1 sharpens it further. Renames only. |
| J2 | `Ranking.swift` — the eligibility flag is built twice, once for origins and once for pages | **fix** | Duplicated Code. With D1 changing the matching rule, two copies is now a live desync risk rather than a stylistic one. Extract one helper, call it from both. |

Standards axis found no hard documented-standard breach. Spec axis found no user-facing scope creep.

## Settled interpretations

Final. No later round may fail these.

1. **D1 and D2 above are settled**, including that `user.github.io` correctly stays below Search for the query `user`.
2. **Empty-query `topByFrecency` using the total-order comparator is accepted**, not scope creep. It is a direct consequence of the determinism criterion covering duplicate and per-host limits.
3. **`isBefore` as a total order is correct and stays.** Row order must not depend on history arrival order or dictionary iteration.
4. **The span-density fuzzy rule is correct and stays.** A scattered subsequence cannot reach maximum fuzzy quality.
5. **URL-like input keeps Open first, Search second**, exclusive of any promotion.
6. **Tests assert row kinds and `actionURL` order, never scoring constants.**

## Round 1 outcome

5 fixes owed: SP1, SP2, SP4 (behavior + tests), J1, J2 (naming + dedupe). SP3 closed as won't-fix by owner decision.
