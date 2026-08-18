# Remediation review 1 — issue #13

Checked: frozen ledger via `git show main:.mayosdd/tickets/evidence/issue-13-palette-ranking/ledger.md`; fix delta `git diff 1da2c44...a9edbe8` (code: `b3669cb`; evidence: `a9edbe8`); `git show a9edbe8` of `PaletteModel.swift`, `Ranking.swift`, `PaletteTests.swift`. Interaction-only read of `PaletteController.applyAutocomplete` at `a9edbe8` (unchanged). Did not re-run tests: this worktree is not `v0.4/issue-13-palette-ranking`. Did not re-review unchanged ranking/tier code except to confirm a ledger item.

## Ledger

1. **SP1 — resolved.** Promotion is no longer `firstIndex(where:)` on the tier-sorted list. `bestEligibleIndex` walks `matchesRegistrableLabel` and keeps the higher `r.frecency`; match-tier `score` is not used unless frecency is equal (`isBefore`).

```
} else if let promoted = bestEligibleIndex(in: matches) {
```

2. **SP2 — resolved.** Rank limit is the full candidate set, not `maxRows - 1`. Display clip is after promotion.

```
limit: max(maxRows, index.pages.count + index.origins.count)
…
return Array(rows.prefix(maxRows))
```

3. **SP4 — resolved.** `frecencyNotTierChoosesAmongEligibleDomains` (`hub` → github above Search, hubspot below) and `eligibleMatchIsNotEvictedByIneligiblePrefixRows` (seven `hub.<site>.com` prefixes cannot hide github). Assertions are row kinds and `actionURL` only.

4. **J1 — resolved.** `IndexedPage.domain` / `Origin.domain` → `registrableDomain`; `RankedResult.matchesDomain` → `matchesRegistrableLabel`.

5. **J2 — resolved.** Both origin and page rank loops call one helper:

```
matchesRegistrableLabel: queryMatchesRegistrableLabel(query, in: origin.registrableDomain)
matchesRegistrableLabel: queryMatchesRegistrableLabel(query, in: page.registrableDomain)
```

6. **D1 — resolved.** Eligibility is the first label of the already-computed registrable domain, not that domain (so not the public suffix):

```
return registrableLabel(registrableDomain).contains(query)
```

`bareTLDQueryFallsToSearch` (`com` → Search); `registrableLabelMatchStillPromotes` (`example` → `shop.example.co.uk`). Pre-existing `registrableDomainPrefixLeadsSearch` still pins `git` → github.com.

7. **SP3 — still unfixed (expected).** `registrableDomain` last-two-labels rule is unchanged; D2 comment added. Not a finding.

## New findings

None of High or Medium from the delta itself.

## needs adjudication

**NA1.** After SP1, the above-Search row and inline type-ahead can name different hosts. For the SP1 fixture (`hub`), `rows()[0]` is github.com (frecency) while `autocompleteHost` still uses `Ranking.rank(..., limit: 1)` (hubspot.com, host-prefix / higher tier) and `applyAutocomplete` completes that host. `selectedIndex` is reset to 0, so Enter follows GitHub. The ledger does not say whether type-ahead must follow the promoted row. Pre-fix both followed hubspot; a similar split already existed when Search led and a host-prefix still completed (`news` / `news.ycombinator.com`). Not scored as a miss.

No ledger fix regressed.
