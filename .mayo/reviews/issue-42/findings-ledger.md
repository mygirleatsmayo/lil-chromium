# Issue #42 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `1b572dd`

## Standards

- S1 · Moved Tier 5 comment says host/title/url; code scores title and URL only · **fix**: make the comment match the code.
- S2 · Repeated-term test passes if both queries return no history; dedupe test passes with dedupe removed · **fix**: assert expected URLs for both queries; give the duplicate enough visits to land inside the cap.
- S3 · `#expect` then `rows[1]` traps instead of failing · **fix**: `try #require` the row-shape precondition (or compare URLs directly).
- S4 · `matchTier(query:terms:…)` carries the canonical query and its terms separately (possible Data Clumps) · **fix**: one small parsed-query value.
- S5 · `gizmoPages` repeats values `visit` already supplies · **fix**: build those fixtures through `visit`.

## Spec

- P1 · "Nothing is lost … every item the current whole-query matcher returns" vs tab/extra-space queries · **won't-fix** · Settled (Lucas): the reference for "nothing is lost" is the whitespace-normalized query. "Repeated terms and extra spaces change nothing" wins over raw-text preservation.
- P2 · "scored by the match tier of its weakest term, then by the existing frecency and tie-break order" · **won't-fix** · Settled (Lucas: keep as built; no ranking-model ticket): the weakest-term tier plugs into the existing `tier × frecency` score, the same formula single-term queries use. Not a lexicographic tier-then-frecency sort.
- P3 · `git git` now promotes `github.com` above Search · **won't-fix** · Settled: "multi-term" counts distinct terms after normalization, so `git git` ≡ `git` (follows from P1).
- P4 · Dedupe of equally frecent `/A` vs `/a` keeps whichever the browser reported first · **fix** · Settled: "Results stay a total order that does not depend on the order the browser reports history in" covers dedupe ties; break the lowercased-URL tie deterministically.
- P5 · Preservation test has one history row, so it passes if that row drops a tier · **fix**: assert the preserved item's tier through row order against a competitor.

## Final review 1

### Standards

- S6 · `host: String, title: String, url: String` travels through both `matchTier` overloads, `anyOrderTier`, and `literalTier` (possible Data Clumps) · **won't-fix**: the triple is the matcher's signature from before #42; the new helpers follow it. Reshaping the matcher's candidate is a refactor outside #42.
- S7 · `PaletteAnyOrderTests` re-declares `visit` and `model`, repeating the `PaletteOrderingTests` fixture builder and palette setup (possible Duplicated Code) · **fix**: one shared fixture builder and palette setup for both suites; #42's suite adds only the example.com root page it needs.
- S8 · This ledger and `.mayo/` changes are branch-only (AGENTS.md: land them on `main` too) · **integration obligation, not code**: satisfied when the branch reaches `main`.

### Spec

- P6 · "Nothing is lost: every item the current whole-query matcher returns … is still returned": three more-frecent same-host any-order matches can fill the per-host cap and push out the whole-query match · **won't-fix** · Settled (Lucas, with P2): "nothing is lost" is a matching guarantee: the item still matches, at no lower tier. Ranking and "The per-host cap and duplicate collapsing apply as today" then apply to it like any other match, as they already do for single-term queries.
- P7 · An unvisited site root inherits a visited page's title and matches `gizmo fix` · **won't-fix** · Settled: site (origin) rows are existing match candidates and match on the same fields as today; the whole-query `fix gizmo` already returns that root. Any-order matching applies to every candidate the whole-query matcher considers.
- P8 · "Repeated terms and extra spaces change nothing": no test covers the whole-query fuzzy fallback, so restoring raw text there passes every test · **fix**: a test where a page matches only through the fuzzy fallback (e.g. `sui bsc` → "SwiftUI Basics") and the same query with extra spaces and a repeated term gives the same rows.

## Review status

- Full review 1: 5 Standards (all fix), 5 Spec (P4, P5 fix; P1–P3 settled won't-fix, P1/P2 pending Lucas).
- Remediation 1 (`3edaf6c...8f69e48`): all 7 fix items resolved, no new defects.
- Final review 1 (`bf45a2f...ad49f35`): 3 Standards (S7 fix; S6 won't-fix; S8 integration), 3 Spec (P8 fix; P6, P7 settled won't-fix).
- Remediation 2 (`ad49f35...5897e86`): S7, P8 resolved, no new defects. Ledger resolved; ready to integrate once Lucas answers D, E (P1, P2, P6) and approves the merge flow.
- Lucas settled P1, P2, P6 as recorded. Ready to integrate.
- Lucas dropped one test-coverage note (no ticket): the two duplicate-removal steps share one test.
