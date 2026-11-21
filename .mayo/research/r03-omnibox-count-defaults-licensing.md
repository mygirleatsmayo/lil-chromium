---
schema: mayo-research-a2a/1
skill: mayo-research@2.1.0
project: lil-chromium
worktree: /Users/mygirleatsmayo/projects/t3-worktrees/lil-chromium/t3-c1fb47de-73de824a0602882f
branch: feat/implement-ready-tickets
scope: focused
status: complete
created: 26-11-19 16:20
updated: 26-11-19 16:20
research_cutoff: 26-11-19
sources: 45
agent_harness: T3 Code / Codex
model: gpt-6.1-sol-high
---

# Question

For lil chromium GitHub issue #45, establish current desktop/macOS Chromium behavior for (1) suggestion count while typing, including dynamic limits, URL/provider caps, culling and dedup; (2) opening/focus zero-suggest content, count and order; (3) Search versus history as the default/Enter result and inline completion; (4) Helium changes; (5) more-results/navigation patterns in Chromium, Raycast, Alfred and Arc; and (6) licensing for code ports or independent Swift implementations in this currently unlicensed public repository.

Given project context: palette currently has at most eight rows, with a planned 4–12 preference; opening state is up to eight frecency-ranked sites without a Search row; Search leads unless a history result literally matches a registrable domain. This report researches precedents; it does not change that product contract.

# Conclusion

1. **Confirmed — recommended route:** use upstream Chromium as a behavioral reference and write the small Swift policy independently. Copying upstream BSD code is also possible with notices. Avoid importing Helium-specific expression unless mygirleatsmayo chooses GPL-compatible licensing for the combined work. A public repository without a license does not resolve third-party obligations. [S20] [S21] [S39] [S40] [S41]
2. **Confirmed:** the macOS Stable release feed currently identifies Chromium **159.0.8154.13**, revision `4d790f9eb4c8abe65b8aaa3feba664e7c734ba56`. Its source enables `OmniboxDynamicMaxAutocomplete`: normal base eight, increased ten, URL cutoff zero. The shorthand “10 without URLs, otherwise 8” omits a nine-search-result boundary case and special modes. **Unverified:** a particular installed Chrome profile's Finch assignments. [S01] [S02] [S03] [S04]
3. **Confirmed:** opening state is context-dependent, predominantly previous/personalized searches and potentially trends; it is not universally eight frecency-ranked sites. The NTP primary section allows eight; ordinary web/SRP limits default to six search suggestions and zero URL suggestions, with separate contextual additions possible. Desktop URL suggestions on focus are compiled **off** by default. [S03] [S12] [S13] [S14]
4. **Confirmed:** the highest-relevance eligible default wins, subject to stability and special-case rules. Eligibility is distinct from relevance. A safe URL prefix completion can win well before an exact registrable-domain match; a title-only history hit is generally not eligible through the ordinary history providers. [S03] [S07] [S08] [S09]
5. **Confirmed:** Helium-specific content is GPL-3.0, imported material retains its original licenses. Helium adds provider controls, defaults remote search suggestions off, and simplifies the popup. **Likely:** its ordinary count policy remains upstream's; the inspected patches contain no replacement of the dynamic-count or top-match algorithms. [S20] [S22] [S23] [S24] [S28]
6. **Confirmed:** Chromium's ordinary desktop popup presents an already-truncated result set, rather than paging through all matching history. Raycast supports page navigation and opt-in incremental loading in extension lists; Alfred exposes visible-result and scrollbar controls. **Unverified:** Arc's current numerical cap or a general Show More policy. [S03] [S34] [S35] [S36] [S42]

# Evidence

## 1. Scope, versions and confidence

**Confirmed:** all upstream claims below target the revision returned by the fresh Mac Stable feed, not Chromium `main`, unless explicitly stated. Chromium source defaults are inspectable; Google Chrome may override features and parameters through field trials, policies or flags. “Enabled by default” below means the compiled declaration, not proof that every live installation receives that setting. No browser was launched and no mygirleatsmayo profile was inspected. [S01] [S02] [S05] [S19]

**Confirmed:** latest non-prerelease Helium macOS release retrieved was `0.22.1.1` (2026-11-18); its `helium-chromium` submodule points to `1bccd2bc5c9b8f513e1bb84a6485ad9ed2427b00`. Current Helium `main`, pinned here at `24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d`, and the release pin both specify Chromium `158.0.8127.36`. The release-to-main comparison contains only update tooling, component updates and page-zoom-indicator changes. The cited omnibox patches therefore apply to that release as well. This is one Chromium milestone behind the queried Mac Stable revision. [S30] [S31] [S32] [S33]

## 2. While typing: count, culling and dedup

### Dynamic maximum — exact ordinary desktop behavior

**Confirmed:** `omnibox_features.cc` declares `kDynamicMaxAutocomplete`, external name `OmniboxDynamicMaxAutocomplete`, enabled on every platform except iOS. Desktop's alternative non-zero-prefix grouping framework is disabled by default, so the ordinary path uses `AutocompleteResult::CalculateNumMatchesPerUrlCount()`. Zero-suggest and exact featured-keyword mode bypass this dynamic calculation. [S02] [S03]

| Input to the policy | Source default / parameter |
| --- | --- |
| Base typing limit | 8; `OmniboxUIExperimentMaxAutocompleteMatches` → `UIMaxAutocompleteMatches` |
| Increased limit | 10; `OmniboxDynamicMaxAutocomplete` → `OmniboxDynamicMaxAutocompleteIncreasedLimit` |
| URL cutoff | 0; same feature → `OmniboxDynamicMaxAutocompleteUrlCutoff` |
| UI experiment's compiled feature state | Disabled; normal hard-coded fallback remains 8 |
| Exact featured-keyword input, e.g. bare `@` | 9 on desktop; separate path |
| General zero-suggest helper | 8 desktop; actual zero-suggest sections have their own limits, below |

All parameter names, defaults and bypass conditions are **confirmed** in `GetMaxMatches`, `GetDynamicMaxMatches`, `CalculateNumMatches`, and `CalculateNumMatchesPerUrlCount`. The dynamic and UI-limit experiments also have `chrome://flags` entries. [S02] [S03] [S05] [S19]

**Confirmed — algorithm:** scan the already ranked/default-adjusted candidates in order. Stop at non-positive demoted relevance. Count a “URL” whenever `!AutocompleteMatch::IsSearchType(type)`. For the current candidate, choose ten while the URL count is at most the cutoff; otherwise choose eight. If the number already retained has reached that chosen limit, stop before retaining the candidate. The function does not first examine every candidate and then choose a single global limit. Unscoped extension-provider matches are specially excluded from this accounting and added to the returned count; experimental modes can therefore exceed the ordinary totals. [S03]

**Confirmed — important boundary behavior**, derived directly from that loop and corroborated by the scaled-down upstream test cases:

| Ranked candidates, with ordinary defaults | Retained |
| --- | --- |
| At least 10 searches, no URL in those positions | 10 searches |
| First URL at position 1–8 | At most 8 total |
| 8 searches, then first URL at position 9 | 8 searches; URL excluded |
| 9 searches, then first URL at position 10 | **9 searches; URL excluded** |
| 10 searches, then URL at position 11 | 10 searches |
| Fewer qualifying candidates than the limit | Only the candidates available |

This is a transcription of control flow for explanation, not a claim that these exact provider outputs were observed in a browser. Upstream `CalculateNumMatchesPerUrlCountTest` explicitly tests the analogous base-two/increased-four case that returns three when the first URL occurs fourth. [S03] [S04]

### URL cap is separate and soft

**Confirmed:** desktop `AutocompleteResult` initializes `max_url_matches_` to **7**. `LimitNumberOfUrlsShown()` counts all positive-demoted-score searches in the candidate pool and computes:

`effective URL cap = max(7, base maximum − available positive-score searches)`

It then removes non-search matches beyond that count. Thus with at least one available search and base eight, the URL allowance is normally seven; if no searches are available it can fill all eight positions with URLs. This is not an absolute seven-URL ceiling and not a per-host/domain limit. Exact featured-keyword mode skips this step. The cap runs before dynamic total-count trimming. [S03]

### Provider caps, including history

**Confirmed:** the generic provider quota is **3 per provider**, not three per host and not three total history results. `OmniboxFieldTrial::GetProviderMaxMatches()` parses comma-separated `provider-id:count` entries and optional `*:count`; without an override it returns three. When ML URL scoring is enabled, the quota string comes from `MlUrlScoringMaxMatchesByProvider` on `MlUrlScoring`; otherwise it comes from `UIMaxAutocompleteMatchesByProvider` on the UI-limit feature. The ML quota parameter defaults to an empty string, hence the same generic fallback. ML URL scoring is compiled enabled on desktop, but successful model use and live overrides are separate concerns. [S02] [S05]

**Confirmed:** `HistoryQuickProvider` searches the in-memory URL/title index with that quota. `HistoryURLProvider` performs URL-prefix matching; it deliberately fetches up to `2 × quota` for each recognized prefix, then handles significance filtering, shorter-URL promotion, redirect culling and trimming. Providers use a separate default **7** quota in keyword mode. A what-you-typed URL and promotion/dedup details mean the quota is not a promise that every provider emits exactly three rows. [S07] [S08] [S44]

**Confirmed:** supporting providers can pass extra ML candidates: `ResizeMatches()` marks excess candidates with zero legacy relevance and `culled_by_provider` when its ML mode is active, instead of physically deleting them. `MlUrlScoringUnlimitedNumCandidates` defaults false. Final reranking and global culling still apply. This is candidate-generation flexibility, not a Show More user interface. [S05] [S06] [S07] [S18]

### Relevance-based culling and ordering

**Confirmed:** ordinary desktop result processing is approximately: merge providers → optionally rerank with ML → cull tail suggestions when appropriate → normalize/deduplicate → sort by demoted relevance → move the chosen eligible default to the front → enforce the URL allowance → stop at non-positive demoted relevance and the dynamic maximum → group the remaining search suggestions above the remaining navigation suggestions, leaving the default at index zero. Async passes also preserve/transfer some earlier results to reduce churn. There are dedicated exceptions for history clusters, actions, keyword modes, extensions and contextual results. [S03] [S11] [S18]

**Confirmed:** this count policy is a ceiling plus a positive-score condition. It does **not** contain a universal rule such as “stop at a large relevance gap,” “show only candidates within X% of the winner,” or “show fewer as the query becomes longer.” Providers may filter weak candidates themselves; for example, `HistoryURLProvider::CullPoorMatches()` rejects insignificant history and default-engine search URLs. [S03] [S08]

### Dedup

**Confirmed:** candidates are grouped using a normalized destination URL plus dedupe category and optional suggest-template-behavior key. Normalization can remove `www.`, equate HTTP/HTTPS unless explicit input requires preservation, omit irrelevant fragments, and canonicalize search-engine URLs by stripping template substitutions unrelated to search terms/intents. It retains important path/query distinctions: this is not registrable-domain dedup. [S03] [S09]

**Confirmed:** duplicate selection has explicit preferences, including featured enterprise/starter-pack matches, equivalent rich entities, open-tab matches, default eligibility, provider preference and finally relevance. Useful properties are merged into the winner and duplicate records retained internally. Removing equivalent rows happens before global trimming, so duplicate providers do not automatically waste display slots. [S03] [S09]

## 3. Focus before typing: zero-suggest

**Confirmed:** “zero” means no newly typed prefix. It includes focusing a nonempty current-page URL, not just an empty palette on a blank page. Context classification, default search engine, profile/privacy state, network eligibility, cached responses and experiment parameters all affect the result. [S14] [S16] [S17]

### Ordinary desktop sections and defaults

1. **Confirmed — New Tab Page / Omnibox Everywhere:** primary `DesktopNTPZpsSection` allows **8** matches. If an eligible in-product-help row exists, the normal section becomes seven and a separate one-row IPH section is added. Its ordered groups allow one cross-device-tab suggestion, personalized zero-suggest/recommendations, trends, then contextual-search suggestions. Recommendation eligibility can change the group contents. Local previous searches share the personalized group; this is not a separate most-visited-site bucket. Secondary/contextual/experimental sections mean “eight primary rows” is more precise than “the entire modern popup always contains exactly eight rows.” [S03] [S12]
2. **Confirmed — Search Results Page:** enabled `OmniboxZpsSuggestionLimit` defaults to `OmniboxZpsMaxSuggestions=6`, `OmniboxZpsMaxSearchSuggestions=6`, `OmniboxZpsMaxUrlSuggestions=0`. The section order is cross-device tab, previous-search-related/personalized searches, most-visited URLs, then an optional contextual action. A contextual action can add to the ordinary limit. [S03] [S12] [S13]
3. **Confirmed — ordinary web page:** separate URL and search sections. The URL section is output first when enabled/allocated; then cross-device/search/contextual groups follow. Default URL allowance is zero and ordinary search allowance six. Optional contextual entries and feature branches change totals. The `max_suggestions` value is not one universal combined cap for every desktop web section. [S03] [S12] [S13]
4. **Confirmed — empty/short results are valid:** missing eligible history, disabled remote suggestions, a non-Google default engine, incognito, privacy permissions, or no cached/server suggestions can leave fewer rows or no normal suggestions. Upstream does not guarantee a populated eight-site opening state. [S14] [S16] [S17]

### Previous searches, most visited and recency

**Confirmed:** `LocalHistoryZeroSuggestProvider` requires non-incognito and a **Google default search engine**. Its default coverage is an empty focused NTP/Omnibox Everywhere input; `LocalHistoryZeroSuggestBeyondNTP` is disabled by default. It enumerates previous search terms for the default provider and ranks them by **frecency**, then assigns decreasing relevance. Its own maximum is eight; final section quotas can be smaller. These are previous search queries, not arbitrary visited URLs. [S02] [S14]

**Confirmed:** remote zero-suggest likewise checks for Google, a valid secure suggestion endpoint and enabled search suggestions. For ordinary web pages, sending the current URL additionally requires active URL-data collection; a Google search-results page has an exception to that requirement. NTP requests can omit the current URL. Server-provided groups/relevance influence ordering; there is no single universal local “recent URLs, then most visited” algorithm. [S16] [S17]

**Confirmed:** `OmniboxUrlSuggestionsOnFocus` is compiled **disabled**. If enabled and allocated URL slots, desktop most-visited results can query the HistoryService directly, with tunable recency window and factor; the default factor is the literal `default`, recency window zero, direct-query mode true. The provider skips search-result URLs, open-tab duplicates, blocklisted entries and repeated titles/normalized URLs, generating up to ten candidate rows. Its fetch ceiling of 500 is an internal candidate bound, not the popup count. Final section quotas still apply. An option exists to use recently closed tabs, default false; it is not a universal default opening-state policy. [S13] [S15]

**Confirmed — configurability:** flags exist for `omnibox-url-suggestions-on-focus`, `omnibox-zps-suggestion-limit`, dynamic maximum and UI maximum. Feature parameters and privacy/search-suggestion preferences also affect output. This is experiment/configuration machinery rather than a normal user-facing 4–12 result-count preference. The Android `OmniboxNumNtpZps…`/`NumWebZps…` controls should not be mistaken for the desktop section defaults above. [S05] [S12] [S13] [S19]

## 4. Search versus history as top/default/Enter

**Confirmed:** `AutocompleteResult::FindTopMatch()` normally chooses the highest **raw relevance** match whose `allowed_to_be_default_match` flag is true, deliberately ignoring type demotion for that choice. It then rotates that match to index zero. The NTP realbox has a search-oriented exception. Subsequent async updates can preserve the existing eligible default to avoid changing the inline completion underneath the user. There is no global “Search always first unless domain exactly matches” test. [S03]

**Confirmed:** verbatim Search has an input-class-dependent relevance: URL-class input gets 850, QUERY/UNKNOWN gets 1300 (`kNonURLVerbatimRelevance`), and keyword state changes the fallback. A valid server verbatim relevance can override the baseline; safeguards preserve usable search behavior. History providers compute their own scores from match quality, typed/visit history and related signals, with optional ML reranking. Therefore eligibility alone does not guarantee a history row wins. [S07] [S08] [S10] [S18] [S45]

**Confirmed — ordinary history eligibility:** `HistoryQuickProvider` and `HistoryURLProvider` derive an inline-completion offset from a prefix of the formatted URL, allowing recognized URL prefixes such as omitted scheme/`www.`. They set the completion suffix and call `SetAllowedToBeDefault()`. If formatting makes that offset invalid, the ordinary fallback cannot become default. A result found only by words in its title or URL interior can still appear as a candidate while remaining ineligible as the default. Exact registrable-domain equality is not required; typing a prefix such as `git` can potentially default to a high-scoring `github.com` visit. [S07] [S08] [S09]

**Confirmed — `SetAllowedToBeDefault()` details:**

1. An `@`-prefixed input allows only the verbatim-search sentinel through this helper.
2. Empty inline suffix means a match may be default even when inline completion is prevented.
3. A nonempty suffix is ineligible when `prevent_inline_autocomplete()` is true, e.g. applicable editing/backspace states.
4. Without trailing whitespace it may be default.
5. With trailing whitespace, that whitespace must itself prefix the completion suffix; the helper consumes the matching whitespace, otherwise rejects default eligibility. [S09]

**Confirmed — HUP promotion threshold:** `CanPromoteMatchForInlineAutocomplete()` requires a typed count of at least one for host-only URLs, or at least two for longer URLs. This is one promotion gate in `HistoryURLProvider`, not a universal rule shared by every history/shortcuts provider. An exact known history URL gets its own promotion path; shorter host suggestions can also be promoted or synthesized. Even a promoted candidate is kept below another eligible default when inline completion is prevented. [S08]

**Confirmed — rich completion exception:** `TryRichAutocompletion()` supports primary URL-prefix completion when enabled. The current method permits secondary/title and shortcut-text completion only when supplied a nonempty shortcut text. It is therefore inaccurate to say “any matching page title can displace Search,” or that all eligible history must literally equal a domain. [S09]

**Confirmed:** selecting a different row with arrow keys changes the Enter target. This section describes the automatic default before manual selection. After default selection and trimming, Chromium groups other search suggestions before other navigations, rather than pinning the single verbatim Search row to a universal fixed index. [S03] [S42]

## 5. Helium differences

**Confirmed — directly changed:**

1. `omnibox-suggestions.patch` adds `helium.omnibox.autocomplete.history_enabled` and `…bookmark_enabled`, both true by default. History disablement gates HistoryQuick, HistoryFuzzy, local-history zero-suggest, shortcuts, past searches and HUP history retrieval. HUP still creates the direct what-you-typed URL before stopping. The settings patch exposes history/bookmark controls. [S23] [S29]
2. The inherited Inox `modify-default-prefs.patch` changes `kSearchSuggestEnabled` from true to **false**. Remote suggestions therefore differ on a fresh profile unless the user enables them. This does not remove the local verbatim “search what I typed” action. The source establishes the default; mygirleatsmayo's actual preference was not inspected. [S24] [S10] [S17]
3. Optional inherited `omnibox-autocomplete-filtering` restricts providers to configured combinations of searches, bookmarks and internal pages. When used, HUP stops after its what-you-typed URL and past-search querying is skipped. It is an explicit flag, not evidence that all Helium users have that behavior. [S25]
4. Cleanup removes several upstream pedal/action suggestions, and another patch disables history clusters. The UI patch changes density/row sizing, padding, styling and popup presentation. These can alter what or how much fits visually without changing the ordinary ranking/count algorithm. [S26] [S27] [S28]

**Likely — inherited policy:** source inspection of all 361 patch files in the pinned common patch tree found no replacement for `CalculateNumMatchesPerUrlCount`, `FindTopMatch`, `GetMaxMatches`, or the dynamic-limit parameter values. The macOS packaging patch tree has no matching count/ranking patch filenames. Upstream 158's corresponding result implementation retains the ordinary dynamic policy described above. This is source evidence for inheritance, not a live Helium UI measurement or proof of every runtime feature state. [S22] [S31] [S33]

**Confirmed — version difference worth retaining:** stable Chromium 159 adds explicit verbatim-URL-case preservation in `Sort()`; the examined 158 base lacks that block. Hence “Helium has no differences at all” would be too strong even before its own patches. [S03] [S33]

## 6. More results and comparable launchers

**Confirmed — normal Chromium desktop popup:** providers and `SortAndCull()` discard extra candidates; `OmniboxPopupViewViews` builds rows for the resulting `result().size()` and sizes the popup to those rows. There is no generic next-page cursor or automatic history “load the next eight” in this path. A visibility toggle for a suggestion group is a different operation from fetching more history. [S03] [S42]

**Confirmed — broader history is a separate destination:** scoped `@history` search can lead to `chrome://history/?q=…`; keyword-mode history providers receive more local slots. That supports a “search full history” escape route as a precedent, but is not ordinary omnibox pagination. **Unverified:** a universal claim that no specialized/experimental Chromium surface has ever used wording like Show More. The evidence supports the ordinary desktop suggestion path only. [S43] [S44]

**Confirmed — Raycast:** official Root Search documentation provides up/down navigation, section jumps, and Option-up/down to move a page of results. Its optional compact opening state shows only the search bar until typing/action-panel use. Extension `List` pagination is opt-in: reaching the end by keyboard or mouse calls `onLoadMore` while `hasMore` is true; new items append, with `pageSize` placeholders. This is separate from how many rows fit in the window. **Unverified:** a stable, universal numeric cap for current Root Search; the official pages inspected do not establish one. [S34] [S35]

**Confirmed — Alfred:** official Appearance Options allow more/fewer displayed results and control the results scrollbar. This is a scrollable viewport model rather than proof that only the visible rows exist. **Unverified:** a current numeric range/default in the official documentation; an old forum claim of a maximum nine is insufficient to assert today's value. [S36]

**Confirmed — Arc:** official command-bar actions include View History, a separate browser-history destination. Its macOS release notes document repeated custom ranking changes and a fix for over-prioritizing URL submission over web search. **Unverified:** a current exact result cap, configurability of that cap, or a generic Show More control. Arc's closed implementation cannot be treated as inspectable Chromium behavior; Windows notes also cannot establish macOS UI details. [S37] [S38]

## 7. Licensing boundaries for this Swift app

**Confirmed — provenance:** Helium's README explicitly licenses its unique code, patches and modified portions under GPL-3.0, while preserving imported material's original licenses. Do not label every byte of Chromium inside Helium GPL, and do not assume a Helium-specific patch is BSD merely because it edits a BSD file. The declaration does not justify silently upgrading the label to GPL-3.0-or-later. [S20] [S21]

### A. Porting Chromium implementation code

**Confirmed:** the inspected omnibox files carry Chromium BSD notices. A C++→Swift translation copying protected expression remains reuse: retain the relevant copyright notices, license conditions and disclaimer in source; reproduce them in binary-distribution documentation/materials; do not imply endorsement by Google/contributors. Check any additional files/dependencies separately. BSD does not require the entire Swift application to become BSD/open source or require publishing its source. Keeping the app otherwise unlicensed is possible, but the imported portion still needs its notices and permission terms. [S39]

### B. Porting Helium-specific implementation code

**Confirmed:** for a distributed derivative, GPLv3 requires notices, license text, prominent modification/date notices, and GPL licensing of the combined covered work, not merely the copied function. Binary distribution also requires a compliant Corresponding Source route, including needed build scripts. Publishing source without granting GPL rights is insufficient. Separate independent works merely aggregated together are different. Applicable interactive-interface legal notices and, in the specified User Product transaction circumstances, installation information also matter; the latter is not automatically required for every macOS app download. [S21] (sections 1, 4–6)

**Likely — application here:** directly transplanting Helium-specific logic into the Swift executable would create a combined derivative subject to those requirements. This conclusion depends on what expression is copied and the resulting relationship between components. A language change, renaming, or putting the function in a different file does not itself establish independence. [S21] (sections 0 and 5)

### C. Independently implementing behavior after reading source

**Confirmed principle; likely application:** US copyright excludes ideas, systems and methods of operation but protects expression. Independently implementing a numerical cap, prefix-eligibility rule or ranking concept does not by itself import the source project's copyright license. Reading code does not automatically make every later implementation a derivative; a close translation of its protected structure/comments/expression can. Record behavioral facts and write an idiomatic implementation from those requirements. A clean-room separation can improve evidence of independence but is not automatically a legal requirement. This is a copyright conclusion, not a patent/trademark clearance. [S41]

**Confirmed — repository status:** no root license file was found by the local file scan; the existing Material Symbols asset license is unrelated. Public GitHub visibility supplies limited hosting/view/fork rights, not a general right to reuse the app. Choosing a project license is a separate owner decision; this research adds none. No missing root license permits omitting Chromium notices or conveying Helium derivatives without GPL compliance. [S40]

## 8. Implications for issue #45 — research recommendation, not an accepted spec

1. **Likely — best fit:** independently implement the narrow behavior mygirleatsmayo wants, retaining these source links for provenance. A full omnibox port would bring provider, ML, default-search and context machinery unrelated to this palette. [S03] [S18]
2. **Confirmed:** if lil chromium has only one Search action plus history URLs, Chromium's ordinary ten-result branch offers almost no increase: any retained URL normally takes the policy back to eight. Dynamic maximum is not evidence for a score-gap-based variable row count. A 4–12 user ceiling would be a local product choice. [S03]
3. **Confirmed:** eight frecency-ranked opening sites are a defensible separate design, but should not be described as current desktop Chromium's universal zero-suggest behavior. Its local frecency precedent is strongest for previous search terms, while URL-on-focus is a separate disabled-by-default feature. [S13] [S14]
4. **Likely:** the most useful Chromium precedent for Search placement is a separate default-eligibility gate plus relevance, with explicit inline completion for safe URL prefixes. It does not substantiate the current exact-registrable-domain gate. Choosing how much of that behavior to adopt remains mygirleatsmayo's decision. [S03] [S07] [S09]
5. **Likely:** if full-history access is needed, an explicit destination or scrollable results are both supported precedents; none of this research establishes that the palette must add a Show More row. [S34] [S35] [S36] [S43]

# Gaps

1. **Non-blocking for a design discussion:** no live Chrome or Helium profile/Finch configuration inspected; no macOS UI observations. Do not add a project `verified:` runtime comment from this source-only report.
2. **Non-blocking:** Arc cap/paging and Raycast/Alfred current numeric viewport limits were not established from authoritative sources. These products provide patterns, not a verified count to copy.
3. **Non-blocking:** general Chromium/Helium algorithm inheritance is supported by pinned source and patch inspection; specialized experiment surfaces and macOS packaging patch contents were not exhaustively executed/tested.
4. **Non-blocking for behavioral reimplementation; blocking for a final licensing choice:** mygirleatsmayo has not selected a project license. Exact derivative-work scope is legal judgment, especially for an actual proposed code port. This report identifies the relevant terms and does not make that owner decision.
5. **Acquisition limits, not contrary evidence:** GNU's official HTML license endpoint timed out twice. Identical GPLv3 text was already retrieved freshly from Helium's LICENSE. GitHub later returned HTTP 429 for two optional enrichment files. The search header and scoped-search explainer were subsequently retrieved directly from Chromium's Gitiles host; the model-service file was not needed because the controller and provider implementations already support the conclusions.

# Sources

All substantive source reads below were freshly acquired on 2026-11-19. Search-engine excerpts were discovery aids; implementation claims rely on the pinned primary files, not old indexed copies. No source failure is treated as an empty result.

1. **S01 — Stable release.** https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=1 — retrieved 2026-11-19; **fresh**.
2. **S02 — Chromium feature defaults.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/common/omnibox_features.cc — retrieved 2026-11-19; **fresh**.
3. **S03 — Result merge, selection, limits and dedup.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_result.cc — retrieved 2026-11-19; **fresh**.
4. **S04 — Dynamic-limit behavior tests.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_result_unittest.cc#L2671 — retrieved 2026-11-19; **fresh**.
5. **S05 — Field-trial parameters and provider quotas.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/omnibox_field_trial.cc — retrieved 2026-11-19; **fresh**.
6. **S06 — Provider trimming.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_provider.cc#L372 — retrieved 2026-11-19; **fresh**.
7. **S07 — HistoryQuickProvider.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/history_quick_provider.cc — retrieved 2026-11-19; **fresh**.
8. **S08 — HistoryURLProvider.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/history_url_provider.cc — retrieved 2026-11-19; **fresh**.
9. **S09 — Match eligibility, normalization and duplicate preference.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_match.cc — retrieved 2026-11-19; **fresh**.
10. **S10 — SearchProvider relevance.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/search_provider.cc#L1380 — retrieved 2026-11-19; **fresh**.
11. **S11 — Type demotions and ordering.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/match_compare.h — retrieved 2026-11-19; **fresh**.
12. **S12 — Suggestion grouping sections.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_grouper_sections.cc — retrieved 2026-11-19; **fresh**.
13. **S13 — Zero-suggest feature configuration.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/common/omnibox_feature_configs.cc#L544 — retrieved 2026-11-19; **fresh**.
14. **S14 — Local-history zero-suggest.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/local_history_zero_suggest_provider.cc — retrieved 2026-11-19; **fresh**.
15. **S15 — Most-visited provider.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/most_visited_sites_provider.cc — retrieved 2026-11-19; **fresh**.
16. **S16 — Remote zero-suggest provider.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/zero_suggest_provider.cc — retrieved 2026-11-19; **fresh**.
17. **S17 — Remote suggestion eligibility.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/base_search_provider.cc#L388 — retrieved 2026-11-19; **fresh**.
18. **S18 — AutocompleteController and ML reranking.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_controller.cc — retrieved 2026-11-19; **fresh**.
19. **S19 — Desktop experiment flags.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/about_flags.cc#L6975 — retrieved 2026-11-19; **fresh**.
20. **S20 — Helium provenance and licensing declaration.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/README.md#license — retrieved 2026-11-19; **fresh**.
21. **S21 — Helium GPLv3 text.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/LICENSE — retrieved 2026-11-19; **fresh**.
22. **S22 — Helium patch tree.** https://github.com/imputnet/helium/tree/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches — retrieved 2026-11-19; **fresh**.
23. **S23 — Helium suggestion-provider preferences.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/core/omnibox-suggestions.patch — retrieved 2026-11-19; **fresh**.
24. **S24 — Inherited search-suggestion default.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/inox-patchset/modify-default-prefs.patch — retrieved 2026-11-19; **fresh**.
25. **S25 — Inherited optional autocomplete filter.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/ungoogled-chromium/add-flag-for-omnibox-autocomplete-filtering.patch — retrieved 2026-11-19; **fresh**.
26. **S26 — Helium suggestion cleanup.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/core/clean-omnibox-suggestions.patch — retrieved 2026-11-19; **fresh**.
27. **S27 — Helium history-cluster removal.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/core/disable-history-clusters.patch — retrieved 2026-11-19; **fresh**.
28. **S28 — Helium popup presentation.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/ui/omnibox.patch — retrieved 2026-11-19; **fresh**.
29. **S29 — Helium suggestion settings.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/settings/omnibox-suggestions-settings.patch — retrieved 2026-11-19; **fresh**.
30. **S30 — Helium macOS release.** https://github.com/imputnet/helium-macos/releases/tag/0.22.1.1 — retrieved 2026-11-19; **fresh**.
31. **S31 — Release-pinned Helium source.** https://github.com/imputnet/helium/tree/1bccd2bc5c9b8f513e1bb84a6485ad9ed2427b00 — retrieved 2026-11-19; **fresh**.
32. **S32 — Helium Chromium base.** https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/chromium_version.txt — retrieved 2026-11-19; **fresh**.
33. **S33 — Helium-base upstream result implementation.** https://github.com/chromium/chromium/blob/158.0.8127.36/components/omnibox/browser/autocomplete_result.cc — retrieved 2026-11-19; **fresh**.
34. **S34 — Raycast Root Search manual.** https://manual.raycast.com/search-bar — retrieved 2026-11-19; **fresh**.
35. **S35 — Raycast List pagination.** https://developers.raycast.com/api-reference/user-interface/list#pagination — retrieved 2026-11-19; **fresh**.
36. **S36 — Alfred appearance options.** https://www.alfredapp.com/help/appearance/#appearance-options — retrieved 2026-11-19; **fresh**.
37. **S37 — Arc command-bar actions.** https://start.arc.net/command-bar-actions — retrieved 2026-11-19; **fresh**.
38. **S38 — Arc macOS ranking changes.** https://resources.arc.net/hc/en-us/articles/20498377604887-Arc-for-macOS-2023-Release-Notes — retrieved 2026-11-19; **fresh**.
39. **S39 — Chromium BSD license.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/LICENSE — retrieved 2026-11-19; **fresh**.
40. **S40 — GitHub: no license.** https://choosealicense.com/no-permission/ — retrieved 2026-11-19; **fresh**.
41. **S41 — US Copyright Office: ideas and methods.** https://www.copyright.gov/help/faq/faq-protect.html — retrieved 2026-11-19; **fresh**.
42. **S42 — Chromium popup consumes the culled list.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/ui/views/omnibox/omnibox_popup_view_views.cc — retrieved 2026-11-19; **fresh**.
43. **S43 — Chromium scoped-search explainer.** https://chromium.googlesource.com/chromium/src/+/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/docs/site_search_explainer.md — retrieved 2026-11-19; **fresh**.
44. **S44 — Keyword-mode provider quota.** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_provider.h#L394 — retrieved 2026-11-19; **fresh**.

45. **S45 — Search verbatim baseline constant.** https://chromium.googlesource.com/chromium/src/+/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/search_provider.h — retrieved 2026-11-19; **fresh**.

Acquisition log:

1. **Fresh:** bounded Exa discovery sets for dynamic-count terminology and official launcher docs; direct `gh api` metadata/tree/ref reads; pinned raw-source reads; Defuddle reads of official Raycast, Alfred and Arc pages; ChromiumDash through web open.
2. **Fresh / bounded negative:** downloaded/scanned the 361 `.patch` entries in the already-shortlisted Helium common patch tree to check for count/default-selection replacements. No matching replacement was found. The release packaging tree was separately inspected for patch paths. This supports “likely inherited,” not proof of runtime equality.
3. **Failed, retried:** `https://www.gnu.org/licenses/gpl-3.0.html` — two timeout responses; no content from that endpoint used. Helium's freshly read license text supplies the GPL evidence.
4. **Failed path discovery, retried:** `components/omnibox/browser/omnibox_feature_configs.{cc,h}` and `…/omnibox_popup_model.cc` returned 404; configs were located under `common/`; actual popup source was retrieved under Views. These were wrong paths, not absent behavior.
5. **Failed, corrected:** the Raycast List API URL under `manual.raycast.com` returned 404; the official `developers.raycast.com` page was found and read successfully.
6. **Failed after retry:** raw GitHub HTTP 429 for optional `search_provider.h` and `autocomplete_scoring_model_service.cc`; subsequent `gh` header access also returned 429. The search header was then freshly acquired from the primary Chromium Gitiles host, confirming 1300. The optional model-service claim was omitted.
7. **Cached / empty:** no cached source material relied upon. No empty external result set is used as substantive evidence. The local root-license file search was **empty** apart from the separately licensed Material Symbols asset.
8. **Local verification:** `git status --short`, `git worktree list`, `rg --files -g '*LICENSE*' -g '*COPYING*'`, repository protocol, and existing research numbering were inspected fresh. No application code, profile preferences or installed browser state changed.

[S01]: https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=1
[S02]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/common/omnibox_features.cc
[S03]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_result.cc
[S04]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_result_unittest.cc#L2671
[S05]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/omnibox_field_trial.cc
[S06]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_provider.cc#L372
[S07]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/history_quick_provider.cc
[S08]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/history_url_provider.cc
[S09]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_match.cc
[S10]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/search_provider.cc#L1380
[S11]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/match_compare.h
[S12]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_grouper_sections.cc
[S13]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/common/omnibox_feature_configs.cc#L544
[S14]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/local_history_zero_suggest_provider.cc
[S15]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/most_visited_sites_provider.cc
[S16]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/zero_suggest_provider.cc
[S17]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/base_search_provider.cc#L388
[S18]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_controller.cc
[S19]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/about_flags.cc#L6975
[S20]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/README.md#license
[S21]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/LICENSE
[S22]: https://github.com/imputnet/helium/tree/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches
[S23]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/core/omnibox-suggestions.patch
[S24]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/inox-patchset/modify-default-prefs.patch
[S25]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/ungoogled-chromium/add-flag-for-omnibox-autocomplete-filtering.patch
[S26]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/core/clean-omnibox-suggestions.patch
[S27]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/core/disable-history-clusters.patch
[S28]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/ui/omnibox.patch
[S29]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/patches/helium/settings/omnibox-suggestions-settings.patch
[S30]: https://github.com/imputnet/helium-macos/releases/tag/0.22.1.1
[S31]: https://github.com/imputnet/helium/tree/1bccd2bc5c9b8f513e1bb84a6485ad9ed2427b00
[S32]: https://github.com/imputnet/helium/blob/24d2abfb7576e2d2df51e3ab15e89bcc5d2a034d/chromium_version.txt
[S33]: https://github.com/chromium/chromium/blob/158.0.8127.36/components/omnibox/browser/autocomplete_result.cc
[S34]: https://manual.raycast.com/search-bar
[S35]: https://developers.raycast.com/api-reference/user-interface/list#pagination
[S36]: https://www.alfredapp.com/help/appearance/#appearance-options
[S37]: https://start.arc.net/command-bar-actions
[S38]: https://resources.arc.net/hc/en-us/articles/20498377604887-Arc-for-macOS-2023-Release-Notes
[S39]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/LICENSE
[S40]: https://choosealicense.com/no-permission/
[S41]: https://www.copyright.gov/help/faq/faq-protect.html
[S42]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/ui/views/omnibox/omnibox_popup_view_views.cc
[S43]: https://chromium.googlesource.com/chromium/src/+/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/docs/site_search_explainer.md
[S44]: https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_provider.h#L394

[S45]: https://chromium.googlesource.com/chromium/src/+/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/search_provider.h
