---
schema: mayo-research-a2a/1
skill: mayo-research@2.1.0
project: lil-chromium
worktree: /Users/mygirleatsmayo/projects/t3-worktrees/lil-chromium/t3-c1fb47de-73de824a0602882f
branch: feat/implement-ready-tickets
scope: focused
status: partial
created: 26-11-19 21:21
updated: 26-11-19 21:21
research_cutoff: 26-11-19
sources: 42
agent_harness: T3 Code / Codex
model: gpt-6.1-sol-high
---

# Question

Research established address-bar/launcher precedents for lil chromium issues #42, #38 and #47: (1) Chromium and Firefox multi-word history tokenization, qualification and scoring; (2) inline completion during Down/Up/Enter/Escape in Chrome, Firefox, Safari and, where relevant, Spotlight/Raycast/Alfred; (3) Chromium same-destination normalization, including scheme, www, ports, query, fragment, slash and case; (4) origins visited only on non-default ports; (5) file-access denial, its error and established extension recovery UX; (6) one-line divergences from current Ranking.swift and the issue rules. Do not repeat r03's count/default/licensing survey. [S38–S42]

# Conclusion

1. **Confirmed — recommended precedent:** for a small implementation that follows an existing browser, Firefox gives the simplest coherent model: all whitespace terms must match across URL/title, first at boundaries then anywhere as fallback; matching is a filter, with Places frecency ordering afterward. Chromium's actual HQP model is more complex: all terms must occur literally, field/boundary occurrences receive points, nonlinear per-term scores are averaged, then multiplied by visit-recency and specificity and mapped to relevance. Neither uses #42's weakest-term tier. Choosing the Firefox model would change the accepted ticket contract and needs Lucas's decision. [S03–S11] [S39]
2. **Confirmed:** Chrome and Firefox replace the input with the arrow-selected result and Enter acts on that result. Keep typed query separately from temporary display and selected destination. **Confirmed:** Chrome's manual Up back to row zero is still a temporary full-value display, not a reset that must restore the original selected suffix; Escape restores the default and saved selection. Firefox explicitly reapplies its autofill when that result is reselected. [S12–S17]
3. **Confirmed:** Chromium's dedupe is conditional URL canonicalization, not `(lowercased host, lowercased path)`. Ordinary query strings, path case, non-root trailing slash and ports matter. HTTP/HTTPS and fragments have input-dependent exceptions. [S25–S28]
4. **Confirmed:** Chromium host-only suggestions retain a visited URL's scheme and non-default port; Firefox has explicit tests completing `ex` to `http://example.com:8888/`. Synthesizing `https://localhost` from `http://localhost:3000/path` contradicts both precedents. [S28–S31]
5. **Confirmed — implementation blocker for #47:** on current stable Chromium, `chrome.windows.create({url: 'file:///…'})` fails with `Cannot navigate to a file URL without local file access.` when file access is off, unless a specific upstream exception applies. The issue's requirement that extension-created file lils still open cannot be satisfied by adding a content-script match alone. [S32–S35] [S41]
6. **Unverified:** Safari's exact field contents and selected range through Down/Up, and current Spotlight inline ghost text. Their public docs do not establish those details; no browser or launcher was driven. This makes the report partial for the full interaction matrix, while Chromium/Firefox implementation conclusions are supported. [S18–S24]

# Evidence

## Scope, version and acquisition

**Confirmed:** fresh Mac Stable feed: Chromium **159.0.8154.13**, commit `4d790f9eb4c8abe65b8aaa3feba664e7c734ba56`. Fresh Mozilla version feed: Firefox **160.0.1**. All Chromium files cited below use that commit; all Firefox files use `FIREFOX_160_0_1_RELEASE`, which was retrieved successfully. The Mozilla feed's other scheduling dates are not evidence that a release event was observed. These are upstream source/default claims, not a live Chrome/Helium profile's Finch assignments or observed GUI behavior. [S01] [S02]

**Confirmed:** issue bodies were freshly retrieved using `gh issue view 42/38/47 --json title,body,comments,url`; all three comment arrays were empty. Local Ranking.swift was read at branch HEAD `dcd348ed440c147215b0d489402a332a02ebbbaf`. Existing r03 was reused only for scope/version context. [S38–S42]

Acquisition result sets: Exa orientation and official-domain lookups were **fresh**, capped at 3–5 hits each. Chromium/Firefox and Markdown Viewer source fetches were **fresh**; retained primary files only. Defuddle reads of Apple, Raycast, Alfred and Mozilla docs were **fresh**. Wrong old file paths were **failed** (404, retried once), not empty evidence; repository directory listings located moved files. In particular, old `components/omnibox/browser/omnibox_edit_model.cc` moved under `chrome/browser/ui/omnibox/`, and Firefox `UrlbarInput.sys.mjs`/`UrlbarView.sys.mjs` moved into `content/`. A guessed Chromium `term_match.cc` path also **failed**; matching helpers are in `in_memory_url_index_types.cc`. No empty search result set underpins a claim that a product lacks a feature.

## 1. Multi-word history queries

### Chromium: index words versus final terms

**Confirmed:** `URLIndexPrivateData::HistoryItemsForTerms()` lowercases input. For candidate retrieval it unescapes URL components and breaks punctuation-separated words using its tailored word-break iterator. Example in code: `colspec=ID%20Mstone Release` produces words `colspec`, `id`, `mstone`, `release`. It intersects the URL/title history-ID sets for those words; longest words run first. Candidate scoring separately calls `GetTermsAndWordStartsOffsets()`, which splits the original lowercased input on UTF-16 whitespace and discards empty pieces. URL punctuation within one whitespace term remains part of that final term. Thus `foo.bar` is not simply treated as two independent user terms in scoring. Candidate pools above 500 are trimmed using typed count, visits and recency before full scoring. If the cursor is inside the query, the index can also try a version split at the cursor; normal end-of-input typing does not add that variant. [S03: `HistoryItemsForTerms`, `HistoryIDsFromWords`, `TrimHistoryIdsPool`, `GetTermsAndWordStartsOffsets`]

**Confirmed:** repeated whitespace does not introduce additional final terms. A trailing space can suppress inline completion even though it does not change the final term list: HQP explicitly checks the last character for whitespace before declaring a single term inlineable. [S03] [S04: constructor]

**Confirmed:** repeated terms are **not deduplicated** in the final scoring vector. Every copy gets its own term number, and its occurrences enter the arithmetic mean again. A repeated term can therefore reweight quality in a mixed query (`foo bar foo`); “repeated terms change nothing” is a separate #42 product rule, not Chromium's universal rule. Repeats do not require separate occurrences: each term independently searches the same text. The `seen_search_words` set deduplicates alternate searches, not words within one query. `SortMatches()` sorts without uniquing. [S03] [S04] [S05]

### Chromium: all terms occur; boundaries affect score

**Confirmed:** `ScoredHistoryMatch` checks each final term with contiguous substring search in the cleaned URL and cleaned page title. If a term appears in neither, the candidate is rejected. Terms may appear in different fields and in any order. The host is a component of the URL, not a third independent field. `MatchTermInString()` uses `find()` and searches at most the first 2048 UTF-16 code units of each cleaned string. No subsequence edit, gap allowance or edit distance exists in this path. [S04: constructor] [S05: `MatchTermInString`]

**Confirmed:** occurrence existence and scoring eligibility are different. In URL host text, mid-word matches can contribute a smaller score. In URL path/query/ref, scheme, and titles, ordinary scoring retains word starts plus contiguous continuations of an already retained match. Punctuation-only terms have a special exemption. Example: `stack overflow` can score in `stackoverflow` through the continuation rule. A disjoint middle fragment may occur literally and satisfy the initial all-terms check while contributing zero topicality; the current implementation does **not** reject every zero-scored term individually, but thresholds the final average. This differs from historical versions of this code. Upstream tests explicitly show a boundary term plus disjoint mid-word term can retain positive topicality. [S04: `FilterTermMatchesByWordStarts`, `FilterUrlTermMatches`, `GetTopicalityScore`] [S08: `GetTopicalityScore_MidwordMatching`]

**Confirmed:** title matching scores only a configurable number of leading words. The current default is **20**, despite a stale inline `only count the first ten words` comment. Scheme and TLD credit default off; a literal occurrence can still participate in qualification without receiving credit there. There is no explicit out-of-order penalty in the legacy topicality formula; the source retains a TODO to add one. This does not promise absolute rank invariance under every term permutation/continuation edge case or downstream reranker. [S04] [S06: `HQPNumTitleWordsToAllow`, `HQPAllowMatchInTLDValue`, `HQPAllowMatchInSchemeValue`]

### Chromium: combine quality, visits and final relevance

**Confirmed:** per-occurrence raw points are added **within each term**, rather than taking its strongest occurrence or the weakest term:

| Occurrence | Raw points, subject to filtering/defaults |
| --- | --- |
| Host before final dotted component, at word start | 10 |
| Same host area, mid-word | 2 |
| Path | 8 |
| Query/ref | 5 |
| Title in allowed leading words | 8 |
| Final dotted host component | 10 at boundary / 0 mid-word, only if TLD scoring enabled |
| Scheme | 10 only if scheme scoring enabled |

All occurrences can contribute, including URL and title hits for the same term. The exact offsets and component handling are in `IncrementUrlMatchTermScores()`; do not generalize this into a PSL-aware “registrable domain tier.” [S04] [S07: relevance-versus-highlighting comments]

**Confirmed:** transform each raw per-term sum `s`: below 10, `0.1*s`; at least 10, `1 + 2.25*log10(0.1*s)`, with the sum capped by the lookup-table range. Average transformed scores across all query terms. Average below default topicality threshold **0.5** yields zero. Thus a strong term can compensate for a weak term, and repeated occurrences help with diminishing returns. [S04: `InitRawTermScoreToTopicalityScoreArray`, `GetTopicalityScore`] [S06]

**Confirmed:** multiply topicality by visit frequency and document specificity. Visit frequency sums the newest at most **10** visits, each weighted by transition/bookmark credit and a piecewise age-decay table; typed visits default **1.5**, ordinary visits **1**. This is not the app's `log10(1 + visits + 3*typed) × half-life(lastVisit)` formula. The specificity multiplier uses the number of distinct candidate hosts (counting stops at four), rather than raw duplicate page count; the default mapping is `1→3`, `2→2.5`, `3→2`, `4→1.5`. Map the product through piecewise-linear relevance buckets; the documented default bucket anchors are `0:550, 1:625, 9:1300, 90:1399`. HQP adds provider/default-inline constraints and decreasing relevance allocation afterward; global ML URL scoring can further rerank. These details describe legacy HQP scoring, not a complete specification of all modern omnibox ranking. [S04: `GetFrequency`, `GetDocumentSpecificityScore`, `GetFinalRelevancyScore`] [S06] [S07] [S42]

### Firefox: all tokens plus frecency

**Confirmed:** `UrlbarTokenizer.splitString()` trims input and splits on Unicode whitespace. `data:` input is a special case; very long strings tokenize the first 500 characters with a catch-all final token. It recognizes restriction characters and URL-like tokens. The Places provider may strip an initial scheme/`www` and filters restriction tokens before passing remaining search text to SQL. It does not demand the original phrase or term order. [S09] [S10: constructor/filterTokens/searchString]

**Confirmed:** `AUTOCOMPLETE_MATCH` tokenizes the SQL search string on whitespace and independently checks **every** token against URL, page/bookmark title and tags. Default search is OR across fields for each token, AND across tokens. URL includes host; host has no separate match field. Restriction modes can require title only, URL only, or both. URL matching applies URL fixup, Unicode lowercasing, and optional diacritic folding; it is not a byte-for-byte literal comparison. Repeated tokens recheck the same predicate and do not require extra occurrences, so ordinary Places boolean matching is repeat-insensitive. [S11: `MatchAutoCompleteFunction::OnFunctionCall`, `findInString`, `fixupURISpec`]

**Confirmed:** ordinary Places starts with `MATCH_BOUNDARY`. If too few general results have been produced, it repeats with `MATCH_ANYWHERE`. Boundary matching allows a partial contiguous word, not only complete words. The anywhere fallback is still a contiguous substring matcher. Neither pass performs fuzzy/subsequence matching. This claim is scoped to `UrlbarProviderPlaces`; Firefox has other providers, including a separately named semantic-history provider, which were not analyzed as equivalent to Places. [S10: `#matchBehavior`, query execution] [S11: `getSearchFunction`, `findInString`]

**Confirmed:** per-term matching returns a boolean; there is no per-term quality min/mean/product multiplied into frecency here. The SQL filters then orders by selected Places frecency field descending (`frecency` or `alt_frecency` depending on configuration), then history row ID descending. Boundary pass precedes anywhere fallback; the muxer/provider ecosystem adds heuristic, adaptive and grouping behavior. Claiming a complete Firefox ranking formula from this one provider would overreach. [S10: `defaultQuery`, `PAGES_FRECENCY_FIELD`, `execute` loop] [S11]

## 2. Inline completion and arrow navigation

**Confirmed — shared implementation distinction:** original typed text, displayed editing value and selected result are separate state. The browser does not have to mutate the search query every time arrows preview a different row. This is the useful precedent for #38. “The field is authoritative” should mean the current selected result and display agree, not that every temporary display replacement starts a new search. [S12] [S15–S17]

| Product | Down away from inline result; Enter | Up back to top | Escape |
| --- | --- | --- | --- |
| Chrome / Chromium **confirmed** | Model switches to selected match's `fill_into_edit`, clears inline suffix state, native view places caret at end; Enter opens selected match's destination. | Ordinary manual selection still uses temporary text even on row zero; full top-match value is shown with caret at end. It is not the `reset_to_default` path. | With temporary text: restore default result, recompute default inline text and restore saved selection. Without temporary text, if popup open: close it first. Later Escape can revert/select current-page display and ultimately blur. |
| Firefox **confirmed** | View selection calls `setValueFromResult`; a URL row supplies URL text, a search suggestion its query text; selected result is retained for activation. Enter picks that result. | Reselecting a result with `autofill` calls `_autofillValue`, restores its full completion and selected suffix range. | Current stable controller closes an open popup first; it does not invoke `handleRevert` in that branch. Later Escape calls revert to current page/selects it, or focuses content when configured/already reverted. Do not assert the older “first Escape always restores typed query” rule. |
| Safari **partial** | **Likely** a selected navigation result becomes the Enter target. **Unverified** exact field text/range on Down from inline completion. | **Unverified** whether selected inline suffix is restored versus full-value preview. | **Confirmed documentation:** while typing, Escape restores current webpage address. The docs do not specify multi-stage behavior with temporary selection. |

Chromium source: `SetPopupSelection()` chooses temporary versus default path explicitly; `OnPopupDataChanged()` clears inline state on entering temporary mode; native `OnTemporaryTextMaybeChanged()` sets caret at end; `OpenSelection()` uses selected result. `RevertTemporaryTextAndPopup()` restores default and saved selection. The focused `PopupInlineAutocompleteAndTemporaryText` test exercises the shared selection path. [S12–S14]

Firefox source: `UrlbarView.#selectElement()`, `UrlbarInputBase.setValueFromResult()`, `_autofillValue()`, `pickResult()` and `UrlbarChildController` Escape branch. This release has moved code; reports based on older `UrlbarInput.sys.mjs` paths may describe different Escape behavior. [S15–S17]

Safari docs say choose a suggestion or Return to search, and separately document Escape/current-page restoration. They do not establish exact selection-range behavior; do not cite them as if a live key sequence was tested. [S18] [S19]

### Launchers

1. **Confirmed:** Raycast documents arrow navigation and Return executing the selected item's primary action. Its root search docs show a query-driven launcher, not a documented browser-style selected suffix completion. **Unverified:** a universal assertion that no Raycast command has inline completion. Its own current Search Bar and Keyboard Shortcuts pages conflict on Escape (clear-then-close versus close root); a live check is required before choosing one as precedent. [S22] [S23]
2. **Confirmed:** Alfred's Script Filter `autocomplete` is explicit text insertion on Tab (default), or on actioning a `valid:false` result when configured. An item's actionable `arg` can differ from displayed title or query. That is completion support, but not evidence for an omnibox-style automatically selected suffix. **Unverified:** exact global field display and Escape states across current Alfred views; do not borrow those as established here. [S24]
3. **Confirmed:** Spotlight docs support arrows to navigate and Return to open a result; current docs also assign Up to recent searches in relevant contexts. **Unverified:** current inline ghost-text behavior and its Down/Up range semantics. No supported inline-completion policy can be inferred from the public shortcut table alone. [S20] [S21]

## 3. Chromium same-destination dedupe

**Confirmed:** `AutocompleteMatch::GURLToStrippedGURL()` creates a comparison key from a canonical `GURL`. That key is not necessarily the URL ultimately opened. Full result dedupe also considers category/template behavior, and special Google Docs/search-template canonicalization runs before ordinary substitutions. This section concerns normal HTTP(S) navigation suggestions. [S25] [S26] [S42]

| Difference | Ordinary stripped-destination behavior | Confidence / source |
| --- | --- | --- |
| `http` versus `https` | Usually equated by replacing HTTPS with HTTP. Preserve distinction if input explicitly supplies an HTTP(S)-prefixed term matching the URL content. Other schemes are not universally removed. | **Confirmed** [S25] [S26] |
| Leading `www.` | Remove one leading `www.` from host. Not all subdomains. | **Confirmed** [S25] [S26] |
| Explicit default port | GURL removes default ports for the original scheme: `http://x:80/` = `http://x/`; `https://x:443/` = `https://x/`. Both ordinarily dedupe across scheme afterward. | **Confirmed** [S27] |
| Non-default port | Port component is not deliberately stripped. `:3000` and `:3001` remain different, as does `:3000` versus no port. Scheme replacement can trigger target-scheme port canonicalization: e.g. HTTPS `:80` is non-default initially but is default after replacement to HTTP. Treat “all non-default ports always survive” as too broad. | **Confirmed** preservation mechanism [S25] [S27]; **likely**, code-derived target-scheme `:80` edge, no live/test execution |
| Query | Preserve ordinary query and parameter values/order. `?id=1` and `?id=2` differ. Search-engine templates can remove irrelevant substitutions, and Docs has its own equivalence logic. | **Confirmed** [S25] |
| Fragment | Remove if the input has no fragment and search terms are not stored in a template's fragment. Preserve when input includes a fragment, or fragment-based search terms require it. | **Confirmed** explicit tests [S25] [S26] |
| Empty root path versus `/` | Canonical GURL gives HTTP(S) a root slash, so equal. | **Confirmed** [S27] |
| `/path` versus `/path/` | Distinct: ordinary strip logic does not remove a non-root slash. | **Confirmed**, direct source inference [S25] [S27] |
| Case | Scheme/host canonicalize case. Path/query case is preserved; `/Foo` and `/foo` can open different pages. Do not lowercase the whole URL as a key. | **Confirmed** [S25] [S27] |

**Confirmed:** `Ranking.buildIndex()` already destroys URL distinctions before `dedupeByURL()` runs: pages key by normalized host and lowercased path, omitting ports, scheme, query and fragment; it trims non-root trailing slashes. Merely improving the final dedupe helper cannot recover pages discarded during index construction. The root seam is the snapshot's identity key. [S38]

## 4. Non-default-port origin suggestions

**Confirmed:** Chromium `HistoryURLProvider::ConvertToHostOnly()` calls `visitedURL.GetWithEmptyPath()`. `GURL::GetWithEmptyPath()` resets query/ref, shrinks the path to `/`, and preserves the authority, including non-default port, and scheme. A URL-derived suggestion from `http://localhost:3000/path` therefore has `http://localhost:3000/`. Prefix qualification/promotion thresholds still decide whether the suggestion appears; this is not a guarantee every query shows a host row. Chromium may separately offer a what-you-typed/default-port navigation for an intranet host; that does not justify silently changing the URL-derived history completion. [S28] [S29]

**Confirmed:** Firefox's `test_autofill_origins.js`, task `port`, inserts a typed visit to `http://example.com:8888/`; input `ex` must autofill `example.com:8888/` and complete `http://example.com:8888/`. `portPartial` covers a partially typed port. Origin SQL reconstructs destination from stored prefix plus stored origin host. Tests are a stronger direct answer than assuming host means `hostname` without a port. [S30] [S31]

## 5. File access, failure and recovery

**Confirmed:** current `WindowsCreateFunction::Run()` validates every URL using `ExtensionTabUtil::PrepareURLForNavigation()` **before** creating the browser window. With an ordinary extension and file access denied, that helper returns its file-navigation error. Thus the API Promise rejects / callback gets `runtime.lastError`; it is not merely a successful file window without a content script. Upstream unit tests cover rejection of `file:///etc/passwd` and `view-source:file:///etc/passwd`, then success after setting file access true. [S32] [S33] [S35]

Exact current error constant: `Cannot navigate to a file URL without local file access.` [S34]

**Confirmed:** exceptions include the built-in PDF extension and enterprise policy explicitly allowing file URL navigation. Trusted WebUI calls without an extension also have different treatment. An already-opened file tab and subsequent denied content-script injection are a separate flow from supplying a file URL to `windows.create`; the issue conflates them. **Unverified:** Helium's pinned build has an exemption, or that any native-launch fallback would preserve the requested lil/popup behavior. Do not silently introduce a workaround based on this research. [S33] [S41]

**Confirmed:** Markdown Viewer provides an established recovery pattern: explanatory local-file setup instructions; query `chrome.extension.isAllowedFileSchemeAccess`; show an **Allow Access** button when false; button calls `chrome.tabs.create({url: 'chrome://extensions/?id=' + chrome.runtime.id})`; user manually toggles access. Extension code can open its own details page. This does not let it change the toggle or inject into that internal page. That precise code path is present in current `options/origins.js`. [S36] [S37]

**Recommendation, grounded in that precedent:** if denied file opening must become usable, surface a concise error with an action to open extension details, then allow a user retry after enabling access. This is additional scope beyond #47's original “no prompting” rule and requires an explicit product decision. Source evidence does not authorize rewriting issue acceptance criteria. [S37] [S41]

## 6. Requested one-line divergences

1. **Multi-word:** Ranking.swift treats the whole query as one substring/subsequence; #42 repairs AND/any-order qualification, but repeat removal, weakest-term tier, whole-query-fuzzy preservation and literal-anywhere eligibility are app rules rather than Chromium HQP/Firefox Places scoring. [S03–S11] [S38] [S39]
2. **Inline/arrows:** #38 aligns default completion and Return, but omits browser-style temporary field replacement during arrow selection; Chromium and Firefox agree on selected-result activation but differ on Up-to-top suffix restoration and Escape stages. [S12–S17] [S40]
3. **Dedupe:** Ranking.swift collapses ports, all queries, path case and non-root trailing slashes at index construction; Chromium preserves those destination distinctions except explicit special canonicalizations. [S25–S27] [S38]
4. **Origins:** Ranking.swift aggregates solely by stripped hostname and synthesizes `https://<host>`; Chromium and Firefox preserve non-default ports, and URL-derived Chromium hosts retain the visited scheme. [S28–S31] [S38]

# Gaps

1. **Blocks exact completion of question 2:** no live Safari/Spotlight/Raycast/Alfred key sequence was run. Safari Down/Up display/range and current launcher inline behavior remain unverified. Raycast's current docs disagree about Escape. Use the Chromium/Firefox source-backed policy now; do not advertise full cross-product unanimity.
2. **Does not block #47 contradiction:** no current installed Helium/Chrome integration run with the toggle off. The current stable source and upstream tests establish API rejection. A fork/release-specific exception would need direct inspection before claiming otherwise.
3. **Does not block 1–4:** global omnibox ML ranking, personal history/profile prefs/Finch, and full Firefox muxing/provider precedence are outside this focused query. The stated formulas are the named history providers, not every row the browsers can show.
4. **Does not block basic port identity:** the scheme-change/non-default-`:80` dedupe edge is a code-derived inference, not an executed test. Preserve `:3000`/`:3001` in the app regardless.
5. Research artifact only; no runtime source, issue, PR, browser profile or user-facing prose was changed.

# Sources

- **S01 — Mac Stable release feed:** https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=1 — retrieved 2026-11-19; **fresh**.

- **S02 — Firefox version feed:** https://product-details.mozilla.org/1.0/firefox_versions.json — retrieved 2026-11-19; **fresh**.

- **S03 — Chromium URLIndexPrivateData:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/url_index_private_data.cc — retrieved 2026-11-19; **fresh**.

- **S04 — Chromium ScoredHistoryMatch:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/scored_history_match.cc — retrieved 2026-11-19; **fresh**.

- **S05 — Chromium matching types:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/in_memory_url_index_types.cc — retrieved 2026-11-19; **fresh**.

- **S06 — Chromium HQP configuration defaults:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/omnibox_field_trial.cc — retrieved 2026-11-19; **fresh**.

- **S07 — Chromium HistoryQuickProvider:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/history_quick_provider.cc — retrieved 2026-11-19; **fresh**.

- **S08 — Chromium topicality tests:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/scored_history_match_unittest.cc — retrieved 2026-11-19; **fresh**.

- **S09 — Firefox tokenizer:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/browser/components/urlbar/UrlbarTokenizer.sys.mjs — retrieved 2026-11-19; **fresh**.

- **S10 — Firefox Places provider:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/browser/components/urlbar/UrlbarProviderPlaces.sys.mjs — retrieved 2026-11-19; **fresh**.

- **S11 — Firefox Places SQL functions:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/toolkit/components/places/SQLFunctions.cpp — retrieved 2026-11-19; **fresh**.

- **S12 — Chromium omnibox editing model:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/ui/omnibox/omnibox_edit_model.cc — retrieved 2026-11-19; **fresh**.

- **S13 — Chromium omnibox native view:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/ui/views/omnibox/omnibox_view_views.cc — retrieved 2026-11-19; **fresh**.

- **S14 — Chromium omnibox editing tests:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/ui/omnibox/omnibox_edit_model_unittest.cc — retrieved 2026-11-19; **fresh**.

- **S15 — Firefox result view:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/browser/components/urlbar/content/UrlbarView.mjs — retrieved 2026-11-19; **fresh**.

- **S16 — Firefox input base:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/browser/components/urlbar/content/UrlbarInputBase.mjs — retrieved 2026-11-19; **fresh**.

- **S17 — Firefox keyboard controller:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/browser/components/urlbar/content/UrlbarChildController.mjs — retrieved 2026-11-19; **fresh**.

- **S18 — Safari keyboard shortcuts:** https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac — retrieved 2026-11-19; **fresh**.

- **S19 — Safari search guide:** https://support.apple.com/guide/safari/search-the-internet-sfrid73436cb/mac — retrieved 2026-11-19; **fresh**.

- **S20 — Spotlight search guide:** https://support.apple.com/guide/mac-help/find-what-you-need-with-spotlight-mchlp1008/mac — retrieved 2026-11-19; **fresh**.

- **S21 — Spotlight keyboard shortcuts:** https://support.apple.com/guide/mac-help/spotlight-keyboard-shortcuts-mh26783/mac — retrieved 2026-11-19; **fresh**.

- **S22 — Raycast Search Bar:** https://manual.raycast.com/search-bar — retrieved 2026-11-19; **fresh**.

- **S23 — Raycast Keyboard Shortcuts:** https://manual.raycast.com/keyboard-shortcuts — retrieved 2026-11-19; **fresh**.

- **S24 — Alfred Script Filter JSON:** https://www.alfredapp.com/help/workflows/inputs/script-filter/json/ — retrieved 2026-11-19; **fresh**.

- **S25 — Chromium stripped destination URL:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_match.cc — retrieved 2026-11-19; **fresh**.

- **S26 — Chromium stripped destination tests:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/autocomplete_match_unittest.cc — retrieved 2026-11-19; **fresh**.

- **S27 — Chromium URL canonicalization tests:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/url/url_canon_unittest.cc — retrieved 2026-11-19; **fresh**.

- **S28 — Chromium GURL:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/url/gurl.cc — retrieved 2026-11-19; **fresh**.

- **S29 — Chromium HistoryURLProvider:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/components/omnibox/browser/history_url_provider.cc — retrieved 2026-11-19; **fresh**.

- **S30 — Firefox origin autofill:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/browser/components/urlbar/UrlbarProviderAutofill.sys.mjs — retrieved 2026-11-19; **fresh**.

- **S31 — Firefox origin autofill tests:** https://hg.mozilla.org/releases/mozilla-release/file/FIREFOX_160_0_1_RELEASE/browser/components/urlbar/tests/unit/test_autofill_origins.js — retrieved 2026-11-19; **fresh**.

- **S32 — Chromium windows.create implementation:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/extensions/api/tabs/windows_api.cc — retrieved 2026-11-19; **fresh**.

- **S33 — Chromium navigation permission check:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/extensions/extension_tab_util.cc — retrieved 2026-11-19; **fresh**.

- **S34 — Chromium navigation errors:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/extensions/extension_tab_util.h — retrieved 2026-11-19; **fresh**.

- **S35 — Chromium file navigation tests:** https://github.com/chromium/chromium/blob/4d790f9eb4c8abe65b8aaa3feba664e7c734ba56/chrome/browser/extensions/extension_tab_util_unittest.cc — retrieved 2026-11-19; **fresh**.

- **S36 — Markdown Viewer README:** https://github.com/simov/markdown-viewer/blob/main/README.md — retrieved 2026-11-19; **fresh**.

- **S37 — Markdown Viewer file-access UI:** https://github.com/simov/markdown-viewer/blob/main/options/origins.js — retrieved 2026-11-19; **fresh**.

- **S38 — Local Ranking.swift:** /Users/mygirleatsmayo/projects/t3-worktrees/lil-chromium/t3-c1fb47de-73de824a0602882f/mac/Sources/LilChromiumApp/Ranking.swift — retrieved 2026-11-19; **fresh**.

- **S39 — Issue #42:** https://github.com/mygirleatsmayo/lil-chromium/issues/42 — retrieved 2026-11-19; **fresh**.

- **S40 — Issue #38:** https://github.com/mygirleatsmayo/lil-chromium/issues/38 — retrieved 2026-11-19; **fresh**.

- **S41 — Issue #47:** https://github.com/mygirleatsmayo/lil-chromium/issues/47 — retrieved 2026-11-19; **fresh**.

- **S42 — Existing r03 report:** /Users/mygirleatsmayo/projects/t3-worktrees/lil-chromium/t3-c1fb47de-73de824a0602882f/.mayo/research/r03-omnibox-count-defaults-licensing.md — retrieved 2026-11-19; **cached**.
