# Remediation round 1 — issue #13

Branch: `v0.4/issue-13-palette-ranking`
Worktree: `/Users/mygirleatsmayo/projects/lil-chromium-i13`
Scope: `mac/` only. No change to `extension/`, `docs/PROTOCOL.md`, or `fixtures/`.
Ledger: `main:.mayosdd/tickets/evidence/issue-13-palette-ranking/ledger.md`

Nothing was skipped. D2 was left as-is (no public suffix list).

## D1 — no TLD matching

Eligibility now matches the query against the registrable domain's **distinctive label** (the first label), never the label plus public suffix.

- Helper: `Ranking.queryMatchesRegistrableLabel` (`Ranking.swift:429`) reads the label via `registrableLabel` (`Ranking.swift:436`).
- Call sites: origins `Ranking.swift:229`, pages `Ranking.swift:246`.
- `registrableDomain` itself is unchanged (`Ranking.swift:453`).
- Tests: `bareTLDQueryFallsToSearch` (`PaletteTests.swift:283`) and `registrableLabelMatchStillPromotes` (`PaletteTests.swift:296`).

`com` does not promote `.com` sites. `git` / `hub` still promote `github.com`. `example` still promotes `example.co.uk`.

## SP1 — frecency among eligible domains

`PaletteModel.rows` no longer uses `firstIndex(where:)` on the tier-sorted list.

- `RankedResult.frecency` carries the raw frecency (`Ranking.swift:88–90`), filled at `Ranking.swift:228` (origins) and `Ranking.swift:245` (pages).
- `bestEligibleIndex` (`PaletteModel.swift:112`) picks the eligible row with the highest frecency; equal frecency falls back to `Ranking.isBefore` so the pick stays a total order.
- Promotion call: `PaletteModel.swift:99`.

## SP2 — eligibility before the row budget

`PaletteModel.swift:82` now ranks the full candidate set (`limit: max(maxRows, pages + origins)`), not `maxRows - 1`. Display clipping is only `rows.prefix(maxRows)` at `PaletteModel.swift:106`. An eligible row can no longer be dropped because ineligible host-prefix rows filled the old budget.

## SP4 — boundary tests

Added to `PaletteOrderingTests` in `PaletteTests.swift`. Assertions are row kinds and `actionURL` order only.

| Test | Lines | Covers |
|---|---|---|
| `frecencyNotTierChoosesAmongEligibleDomains` | 252 | SP1: `hub` → github.com (interior, more frecent) above Search, hubspot.com below |
| `eligibleMatchIsNotEvictedByIneligiblePrefixRows` | 266 | SP2: seven `hub.<site>.com` prefixes cannot hide github.com |
| `bareTLDQueryFallsToSearch` | 283 | D1: `com` leads with Search |
| `registrableLabelMatchStillPromotes` | 296 | D1: `example` promotes `shop.example.co.uk` |

## J1 — names

Renames only (plus the D1 helper they now call):

- `IndexedPage.domain` → `registrableDomain` (`Ranking.swift:53`, assigned `Ranking.swift:141`)
- `Origin.domain` → `registrableDomain` (`Ranking.swift:63`, assigned `Ranking.swift:186`)
- `RankedResult.matchesDomain` → `matchesRegistrableLabel` (`Ranking.swift:93`; uses `PaletteModel.swift:114`)

## J2 — one eligibility helper

`origin.domain.contains(query)` and `page.domain.contains(query)` are gone. Both rank loops call `queryMatchesRegistrableLabel(_:in:)` (`Ranking.swift:429`, used at `Ranking.swift:229` and `Ranking.swift:246`).

## Final eligibility rule

For non-empty, non-URL text:

1. Take the host, strip `www.`, compute the v0.4 registrable domain (last two labels; last three when the TLD is two letters and the second-to-last is `co`/`com`/`net`/`org`/`ac`/`edu`/`gov`/`ne`/`or`).
2. Take that domain's **first label only** (the distinctive label). Do not match against the public suffix.
3. The query is eligible iff it is a contiguous literal substring of that label (prefix or interior).
4. Subdomain, title, path, query-string, and fuzzy-only matches are not eligible.
5. If any eligible result exists, the most-frecent one sits above Search. Match tier does not decide this slot. Remaining history (including other eligible rows) sits below Search in the existing total order.
6. If none exist, Search is first.
7. URL-like input is Open, then Search, with no promotion.
8. `user.github.io` / herokuapp / appspot stay as last-two-labels (`github.io`, …). Query `user` does not promote `user.github.io`. Documented at `Ranking.swift:449–452`.

Hand checks: `com` → Search; `git`/`hub` → `github.com`; `example` → `example.co.uk`; `news` on `news.ycombinator.com` → Search.

## Red then green (SP1 and SP2)

Tests were added first, then production code. Command (both runs), from `mac/`:

```
swift test --filter 'frecencyNotTierChoosesAmongEligibleDomains|eligibleMatchIsNotEvictedByIneligiblePrefixRows|bareTLDQueryFallsToSearch|registrableLabelMatchStillPromotes'
```

**Red (tests only, production still old):** SP1 failed because hubspot.com (prefix, higher tier) beat github.com. SP2 failed because Search led (`rows[0].kind → .search`) and the action URL was Startpage for `hub`. D1 TLD also failed (`com` promoted a `.com` history row). `registrableLabelMatchStillPromotes` already passed under the old `domain.contains` rule.

```
Building for debugging...
[Planning 1 / 182]
[Planning deferred tasks]
[1 / 5]
[2 / 6] LilShared
[12 / 41]
[17 / 41]
[21 / 41]
[25 / 41]
[28 / 41]
[33 / 41]
[34 / 41]
[35 / 41]
[36 / 41]
[37 / 41] LilShared
[41 / 43] lilchromium-host
[46 / 49] LilChromiumApp-product
[62 / 84]
[69 / 84]
[72 / 84]
[77 / 84]
[79 / 84]
[81 / 84] LilChromiumApp-product
[83 / 87] LilChromiumApp
[84 / 88] LilChromiumApp
[89 / 93] LilChromiumApp-product
[95 / 99] LilChromiumTests-product
[96 / 103]
[99 / 103] LilChromiumTests-product
[106 / 108] LilChromiumTests-product
[109 / 113] lilchromium-host-product
[112 / 113] lilchromium-host-product
Build complete! (8.14 sec)
􀟈  Test run started.
􀄵  Testing Library Version: 2074
􀄵  Target Platform: arm64e-apple-macos14.0
􀟈  Suite PaletteOrderingTests started.
􀟈  Test registrableLabelMatchStillPromotes() started.
􀟈  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() started.
􀟈  Test frecencyNotTierChoosesAmongEligibleDomains() started.
􀟈  Test bareTLDQueryFallsToSearch() started.
􁁛  Test registrableLabelMatchStillPromotes() passed after 0.001 seconds.
􀢄  Test bareTLDQueryFallsToSearch() recorded an issue at PaletteTests.swift:288:9: Expectation failed: rows[0].kind == .search
􀄵  rows[0].kind == .search → false
􀄵    rows[0].kind → .history
􀢄  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() recorded an issue at PaletteTests.swift:273:9: Expectation failed: rows[0].kind == .history
􀄵  rows[0].kind == .history → false
􀄵    rows[0].kind → .search
􀢄  Test frecencyNotTierChoosesAmongEligibleDomains() recorded an issue at PaletteTests.swift:258:9: Expectation failed: rows[0].actionURL == "https://github.com"
􀄵  rows[0].actionURL == "https://github.com" → false
􀄵    rows[0].actionURL → "https://hubspot.com"
􀢄  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() recorded an issue at PaletteTests.swift:274:9: Expectation failed: rows[0].actionURL == "https://github.com"
􀄵  rows[0].actionURL == "https://github.com" → false
􀄵    rows[0].actionURL → "https://www.startpage.com/sp/search?query=hub"
􀢄  Test frecencyNotTierChoosesAmongEligibleDomains() recorded an issue at PaletteTests.swift:259:9: Expectation failed: rows[2].actionURL == "https://hubspot.com"
􀄵  rows[2].actionURL == "https://hubspot.com" → false
􀄵    rows[2].actionURL → "https://github.com"
􀢄  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() recorded an issue at PaletteTests.swift:275:9: Expectation failed: rows[1].kind == .search
􀄵  rows[1].kind == .search → false
􀄵    rows[1].kind → .history
􀢄  Test bareTLDQueryFallsToSearch() failed after 0.001 seconds with 1 issue.
􀄵  /// D1: `com` is the public suffix, not the distinctive label, so it cannot
􀄵  /// promote every `.com` site above Search.
􀢄  Test frecencyNotTierChoosesAmongEligibleDomains() failed after 0.001 seconds with 2 issues.
􀄵  /// SP1: both domains are eligible, but one is a prefix match (higher tier)
􀄵  /// and the other is a more-frecent interior match. Frecency, not tier,
􀄵  /// chooses the row above Search.
􀢄  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() failed after 0.001 seconds with 3 issues.
􀄵  /// SP2: seven ineligible host-prefix rows would fill the old rank budget
􀄵  /// and drop the eligible interior match, so Search would lead. Eligibility
􀄵  /// is resolved first; github.com stays above Search.
􀢄  Suite PaletteOrderingTests failed after 0.001 seconds with 6 issues.
􀢄  Test run with 4 tests in 1 suite failed after 0.001 seconds with 6 issues.
Note: Some test targets reported failures:
  - LilChromiumTests (Swift Testing)
```

**Green (after D1/SP1/SP2/J1/J2):** all four passed.

```
Building for debugging...
[2 / 5] LilChromiumApp-product
[3 / 6] LilChromiumApp-product
[5 / 9] LilChromiumApp
[6 / 10] LilChromiumApp
[13 / 17] LilChromiumApp-product
[15 / 19] LilChromiumApp-product
[17 / 20] LilChromiumApp-product
[21 / 24] LilChromiumApp
[23 / 26] LilChromiumApp
[26 / 30] LilChromiumTests-product
[28 / 32] LilChromiumTests-product
[34 / 36] LilChromiumTests-product
Build complete! (4.26 sec)
􀟈  Test run started.
􀄵  Testing Library Version: 2074
􀄵  Target Platform: arm64e-apple-macos14.0
􀟈  Suite PaletteOrderingTests started.
􀟈  Test frecencyNotTierChoosesAmongEligibleDomains() started.
􀟈  Test bareTLDQueryFallsToSearch() started.
􀟈  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() started.
􀟈  Test registrableLabelMatchStillPromotes() started.
􁁛  Test frecencyNotTierChoosesAmongEligibleDomains() passed after 0.001 seconds.
􁁛  Test bareTLDQueryFallsToSearch() passed after 0.001 seconds.
􁁛  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() passed after 0.001 seconds.
􁁛  Test registrableLabelMatchStillPromotes() passed after 0.001 seconds.
􁁛  Suite PaletteOrderingTests passed after 0.001 seconds.
􁁛  Test run with 4 tests in 1 suite passed after 0.001 seconds.
```

## Final `swift test` (mac/)

123 tests, 12 suites (119 + the four SP4 cases).

```
Building for debugging...
Build complete! (0.21 sec)
Test Suite 'All tests' started at 2026-08-18 16:01:07.730.
Test Suite 'All tests' passed at 2026-08-18 16:01:07.731.
	 Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.001) seconds
􀟈  Test run started.
􀄵  Testing Library Version: 2074
􀄵  Target Platform: arm64e-apple-macos14.0
􀟈  Suite URLIntentTests started.
􀟈  Suite SearchProviderTests started.
􀟈  Suite PaletteRowsTests started.
􀟈  Suite BrowserCatalogTests started.
􀟈  Suite ConfigDecodingTests started.
􀟈  Suite ConfigMergeTests started.
􀟈  Suite NativeHostManifestTests started.
􀟈  Suite PaletteOrderingTests started.
􀟈  Suite BrowserTableTests started.
􀟈  Suite MessageTests started.
􀟈  Test validTemplatesSubstituteTheEncodedQuery() started.
􀟈  Suite TintTests started.
􀟈  Test switchingPresetsDoesNotOverwriteACustomDraft() started.
􀟈  Test selectingCustomStaysCustomWithFieldVisible() started.
􀟈  Test invalidCustomDraftStaysVisibleAndDoesNotCommit() started.
􀟈  Test displayHostDropsWWWAndFailsClosed() started.
􀟈  Suite RoutingOrderTests started.
􀟈  Test validCustomDraftCommitsTheTemplate() started.
􀟈  Test templateWithoutPlaceholderFallsBackToDefault() started.
􀟈  Test textWithASchemeOrADotIsADestination() started.
􀟈  Test normalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() started.
􀟈  Test settingsOffersTheSixProvidersInOrder() started.
􀟈  Test missingSearchEngineDefaultsToStartpage() started.
􀟈  Test storedProviderIsNotInferredFromTemplate() started.
􀟈  Test urlInputLeadsWithAnOpenRow() started.
􀟈  Test encodingExistingConfigWritesInferredProvider() started.
􀟈  Test everythingElseIsAQuery() started.
􀟈  Test searchTemplateTrimsTheQuery() started.
􀟈  Test configuredSearchEngineIsUsed() started.
􀟈  Test existingNamedProviderStaysExplicit() started.
􀟈  Test searchTemplateSubstitutesTheEncodedQuery() started.
􀟈  Test oneSiteCannotFloodTheList() started.
􀟈  Test selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test unavailableInstallationsAreNotOfferedAsChoices() started.
􀟈  Test mergedReplacesKnownBrowsersWithTheFullScan() started.
􀟈  Test completeConfigDecodesVerbatim() started.
􀟈  Test legacyConfigGetsAdditiveDefaults() started.
􀟈  Test unmatchedQueryOffersOnlySearch() started.
􀟈  Test emptyQueryListsFrequentSitesWithoutASearchRow() started.
􀟈  Test scanKeepsUnavailableInstallations() started.
􀟈  Test nearDuplicatePagesShowOnce() started.
􀟈  Test searchRowFollowsTheTopHit() started.
􀟈  Test installScriptListsTheFullCatalog() started.
􀟈  Test profileDirectoriesAreNeverInstallTargets() started.
􀟈  Test encodingProviderPreservesUnknownTopLevelFields() started.
􀟈  Test writingManifestsCoversEveryExistingCatalogDir() started.
􀟈  Test isInstalledReadsTheCatalogFlag() started.
􀟈  Test autocompleteOffersOnlyAPrefixedHost() started.
􀟈  Test whitelistAddPreservesEverythingElse() started.
􀟈  Test missingInstallationsAreSkipped() started.
􀟈  Test whitelistOpRejectsUnknownOpAndEmptyDomain() started.
􀟈  Test unchangedSaveKeepsUnknownFieldsVerbatim() started.
􀟈  Test savePreservesUnknownTopLevelFields() started.
􀟈  Test saveFromNoExistingFileWritesTheConfig() started.
􀟈  Test partialSiteNameRanksTheOriginFirst() started.
􀟈  Test saveOverCorruptFileStillWrites() started.
􀟈  Test whitelistAddIsIdempotent() started.
􀟈  Test absentHoverBarTintIsOmittedNotNull() started.
􀟈  Test normalizedDomainReducesInputToABareHost() started.
􀟈  Test writtenBytesAreSortedAndStable() started.
􀟈  Test duplicatesAndPerHostCapDoNotDependOnHistoryOrder() started.
􀟈  Test unmatchedTextLeadsWithSearch() started.
􀟈  Test whitelistOpOnFreshFileSeedsDefaults() started.
􀟈  Test queryStringOnlyMatchStaysBelowSearch() started.
􀟈  Test titleOnlyMatchStaysBelowSearch() started.
􀟈  Test whitelistRemoveDropsTheDomain() started.
􀟈  Test unrelatedURLTextStaysBelowSearch() started.
􀟈  Test registrableDomainInteriorMatchLeadsSearch() started.
􀟈  Test denseFuzzyMatchOutranksAScatteredOne() started.
􀟈  Test pathOnlyMatchStaysBelowSearch() started.
􀟈  Test bareTLDQueryFallsToSearch() started.
􀟈  Test case passing 1 argument id → "google" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument id → "ddg" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test frecencyNotTierChoosesAmongEligibleDomains() started.
􀟈  Test frecencyBreaksTiesBetweenEligibleDomains() started.
􀟈  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() started.
􀟈  Test registrableLabelMatchStillPromotes() started.
􀟈  Test case passing 1 argument id → "bing" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test siblingChannelsRemainSeparateInstallations() started.
􀟈  Test catalogIsTheFullSupportedSet() started.
􀟈  Test urlInputKeepsOpenThenSearchAhead() started.
􀟈  Test case passing 1 argument id → "kagi" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument id → "startpage" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test detectionNeedlesDoNotCrossMatch() started.
􀟈  Test registrableDomainPrefixLeadsSearch() started.
􀟈  Test unmatchedParentIsUnknown() started.
􀟈  Test whitelistOpDecodesDefensively() started.
􀟈  Test encodedLineIsCompactAndNewlineTerminated() started.
􀟈  Test everyInstallationHasStableIdentity() started.
􀟈  Test decodeLineToleratesTheTrailingNewline() started.
􀟈  Test legacyOpenDecodesWithoutIncognito() started.
􀟈  Test envelopeDecodesAnyMessageForDispatch() started.
􀟈  Test contextRoundTripsThroughEncoding() started.
􀟈  Test chromeStableHelperPathIsChrome() started.
􀟈  Test profilesAreNotRoutingTargets() started.
􀟈  Test legacyPongDefaultsToUnknownBrowser() started.
􀟈  Test routingIdentitiesAreUnique() started.
􀟈  Test chromeBetaHelperPathIsNotChromeStable() started.
􀟈  Test subdomainOnlyMatchStaysBelowSearch() started.
􀟈  Test protocolDocumentsEveryCatalogEntry() started.
􀟈  Test contextCarriesConfigObjectsAndHostIdentity() started.
􀟈  Test historyResultToleratesSparseRows() started.
􀟈  Test incognitoOpenCarriesTheFlag() started.
􀟈  Test choosingNoTintCommitsNilWithoutRequiringADraft() started.
􀟈  Test hoverBarNilIsNoTint() started.
􀟈  Test presetCommitIsThatPresetsHex() started.
􀟈  Test reseedRestoresDraftFromCommitted() started.
􀟈  Test sleepNilCommitRoundTripsAsGraphiteHex() started.
􀟈  Test hoverBarPresetAndCustomHexRoundTrip() started.
􀟈  Test selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test legacySleepNamedTokensStillDecode() started.
􀟈  Test choicesAreNoneThenPresetsThenCustom() started.
􀟈  Test incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test pickerHexSelectsCustomAndCommits() started.
􀟈  Test sleepNamedTokensDisplayAsChips() started.
􀟈  Test normalOpenOmitsIncognitoOnTheWire() started.
􀟈  Test lineBufferReassemblesSplitReads() started.
􀟈  Test displayedSleepNamedTokenIsNotTheStoredToken() started.
􀟈  Test selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test typingAPresetHexWhileCustomKeepsTheEditorOpen() started.
􀟈  Test customFromNoTintKeepsNilAndStaysEditable() started.
􀟈  Test completedHexNormalizes(input:expected:) started.
􀟈  Test sleepNilOrEmptyCommitStoresGraphiteHex() started.
􀟈  Test sleepPresetAndCustomHexRoundTrip() started.
􀟈  Test primaryThenFallbackThenOtherLiveHosts() started.
􀟈  Test unknownSlugContributesNothing() started.
􀟈  Test configBundleIdBeatsTheBuiltInTable() started.
􀟈  Test primaryLeadsEvenWithNoLiveSockets() started.
􀟈  Test duplicateTargetsCollapse() started.
􀟈  Test seedTreatsPresetHexAsThatChipNotCustom() started.
􀟈  Test launchOrderIsPrimaryFallbackThenInstalled() started.
􀟈  Test tintWritePreservesUnknownFieldsAndStableEncoding() started.
􀟈  Test emptySlugsAreDropped() started.
􀟈  Test needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test unusableSleepTintIsNotCommittedGraphite() started.
􁁛  Test invalidCustomDraftStaysVisibleAndDoesNotCommit() passed after 0.002 seconds.
􀟈  Test openExternalDecodesDefensively() started.
􀟈  Test lilNapChoicesOmitNoTintAndKeepPresetOrder() started.
􀟈  Test emptyPartialAndInvalidDraftsKeepTheCommittedColor() started.
􀟈  Test hoverBarNoTintRoundTripsAsOmittedKey() started.
􀟈  Test onlyAValidCompletedDraftCommits() started.
􁁛  Test switchingPresetsDoesNotOverwriteACustomDraft() passed after 0.002 seconds.
􁁛  Test selectingCustomStaysCustomWithFieldVisible() passed after 0.002 seconds.
􁁛  Test templateWithoutPlaceholderFallsBackToDefault() passed after 0.002 seconds.
􁁛  Test validCustomDraftCommitsTheTemplate() passed after 0.002 seconds.
􁁛  Test validTemplatesSubstituteTheEncodedQuery() passed after 0.004 seconds.
􁁛  Test normalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() passed after 0.004 seconds.
􁁛  Test settingsOffersTheSixProvidersInOrder() passed after 0.004 seconds.
􁁛  Test textWithASchemeOrADotIsADestination() passed after 0.004 seconds.
􁁛  Test storedProviderIsNotInferredFromTemplate() passed after 0.004 seconds.
􁁛  Test everythingElseIsAQuery() passed after 0.004 seconds.
􁁛  Test searchTemplateTrimsTheQuery() passed after 0.004 seconds.
􁁛  Test searchTemplateSubstitutesTheEncodedQuery() passed after 0.004 seconds.
􁁛  Test displayHostDropsWWWAndFailsClosed() passed after 0.004 seconds.
􁁛  Test mergedReplacesKnownBrowsersWithTheFullScan() passed after 0.004 seconds.
􁁛  Test unavailableInstallationsAreNotOfferedAsChoices() passed after 0.004 seconds.
􁁛  Test missingSearchEngineDefaultsToStartpage() passed after 0.004 seconds.
􁁛  Test configuredSearchEngineIsUsed() passed after 0.004 seconds.
􁁛  Test selectingAPresetWritesItsNameAndTemplate(id:) with 5 test cases passed after 0.004 seconds.
􁁛  Test legacyConfigGetsAdditiveDefaults() passed after 0.004 seconds.
􁁛  Test scanKeepsUnavailableInstallations() passed after 0.004 seconds.
􁁛  Test completeConfigDecodesVerbatim() passed after 0.004 seconds.
􁁛  Test urlInputLeadsWithAnOpenRow() passed after 0.004 seconds.
􁁛  Test emptyQueryListsFrequentSitesWithoutASearchRow() passed after 0.004 seconds.
􁁛  Test encodingExistingConfigWritesInferredProvider() passed after 0.004 seconds.
􁁛  Test unmatchedQueryOffersOnlySearch() passed after 0.004 seconds.
􁁛  Test existingNamedProviderStaysExplicit() passed after 0.004 seconds.
􁁛  Test oneSiteCannotFloodTheList() passed after 0.005 seconds.
􁁛  Test isInstalledReadsTheCatalogFlag() passed after 0.005 seconds.
􁁛  Test installScriptListsTheFullCatalog() passed after 0.005 seconds.
􁁛  Test nearDuplicatePagesShowOnce() passed after 0.005 seconds.
􀟈  Test case passing 1 argument onDisk → "gray" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "grey" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "purple" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "#8e8e93" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "#3311aa" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􁁛  Test searchRowFollowsTheTopHit() passed after 0.005 seconds.
􀟈  Test case passing 1 argument input → "" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#f" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#fff0" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#ff" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#gggggg" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "ff00aa" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#ff00aag" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "purple" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument onDisk → "" to selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "none" to selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test case passing 2 arguments input → "#FF00AA", expected → "#ff00aa" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "  #00ff00  ", expected → "#00ff00" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "#f0a", expected → "#ff00aa" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "#007aff", expected → "#007aff" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 1 argument slug → "chrome" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chrome-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chrome-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chrome-canary" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-nightly" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "edge-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "edge-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "edge-canary" to needlePathResolvesToItsOwnSlug(slug:) started.
􁁛  Test autocompleteOffersOnlyAPrefixedHost() passed after 0.006 seconds.
􀟈  Test case passing 1 argument slug → "vivaldi" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "vivaldi-snapshot" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "edge" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera-gx" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera-developer" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "helium" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "arc" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "dia" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "comet" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chromium" to needlePathResolvesToItsOwnSlug(slug:) started.
􁁛  Test whitelistOpRejectsUnknownOpAndEmptyDomain() passed after 0.006 seconds.
􁁛  Test partialSiteNameRanksTheOriginFirst() passed after 0.007 seconds.
􁁛  Test encodingProviderPreservesUnknownTopLevelFields() passed after 0.007 seconds.
􁁛  Test normalizedDomainReducesInputToABareHost() passed after 0.006 seconds.
􁁛  Test saveFromNoExistingFileWritesTheConfig() passed after 0.006 seconds.
􁁛  Test unchangedSaveKeepsUnknownFieldsVerbatim() passed after 0.006 seconds.
􁁛  Test whitelistAddPreservesEverythingElse() passed after 0.006 seconds.
􁁛  Test unmatchedTextLeadsWithSearch() passed after 0.006 seconds.
􁁛  Test titleOnlyMatchStaysBelowSearch() passed after 0.006 seconds.
􁁛  Test whitelistOpOnFreshFileSeedsDefaults() passed after 0.006 seconds.
􁁛  Test duplicatesAndPerHostCapDoNotDependOnHistoryOrder() passed after 0.006 seconds.
􁁛  Test queryStringOnlyMatchStaysBelowSearch() passed after 0.006 seconds.
􁁛  Test absentHoverBarTintIsOmittedNotNull() passed after 0.006 seconds.
􁁛  Test saveOverCorruptFileStillWrites() passed after 0.006 seconds.
􁁛  Test savePreservesUnknownTopLevelFields() passed after 0.006 seconds.
􁁛  Test unrelatedURLTextStaysBelowSearch() passed after 0.006 seconds.
􁁛  Test denseFuzzyMatchOutranksAScatteredOne() passed after 0.006 seconds.
􁁛  Test pathOnlyMatchStaysBelowSearch() passed after 0.006 seconds.
􁁛  Test whitelistAddIsIdempotent() passed after 0.006 seconds.
􁁛  Test frecencyBreaksTiesBetweenEligibleDomains() passed after 0.006 seconds.
􁁛  Test registrableDomainInteriorMatchLeadsSearch() passed after 0.006 seconds.
􁁛  Test frecencyNotTierChoosesAmongEligibleDomains() passed after 0.006 seconds.
􁁛  Test whitelistRemoveDropsTheDomain() passed after 0.006 seconds.
􁁛  Test writtenBytesAreSortedAndStable() passed after 0.006 seconds.
􁁛  Test siblingChannelsRemainSeparateInstallations() passed after 0.006 seconds.
􁁛  Test urlInputKeepsOpenThenSearchAhead() passed after 0.006 seconds.
􁁛  Test bareTLDQueryFallsToSearch() passed after 0.006 seconds.
􁁛  Test registrableDomainPrefixLeadsSearch() passed after 0.006 seconds.
􁁛  Test catalogIsTheFullSupportedSet() passed after 0.006 seconds.
􁁛  Test everyInstallationHasStableIdentity() passed after 0.006 seconds.
􁁛  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() passed after 0.006 seconds.
􁁛  Test registrableLabelMatchStillPromotes() passed after 0.006 seconds.
􁁛  Test envelopeDecodesAnyMessageForDispatch() passed after 0.006 seconds.
􁁛  Test unmatchedParentIsUnknown() passed after 0.006 seconds.
􁁛  Test whitelistOpDecodesDefensively() passed after 0.006 seconds.
􁁛  Test encodedLineIsCompactAndNewlineTerminated() passed after 0.006 seconds.
􁁛  Test chromeStableHelperPathIsChrome() passed after 0.006 seconds.
􁁛  Test legacyOpenDecodesWithoutIncognito() passed after 0.006 seconds.
􁁛  Test legacyPongDefaultsToUnknownBrowser() passed after 0.006 seconds.
􁁛  Test decodeLineToleratesTheTrailingNewline() passed after 0.006 seconds.
􁁛  Test subdomainOnlyMatchStaysBelowSearch() passed after 0.006 seconds.
􁁛  Test chromeBetaHelperPathIsNotChromeStable() passed after 0.006 seconds.
􁁛  Test routingIdentitiesAreUnique() passed after 0.006 seconds.
􁁛  Test profilesAreNotRoutingTargets() passed after 0.006 seconds.
􁁛  Test hoverBarNilIsNoTint() passed after 0.005 seconds.
􁁛  Test historyResultToleratesSparseRows() passed after 0.006 seconds.
􁁛  Test presetCommitIsThatPresetsHex() passed after 0.005 seconds.
􁁛  Test incognitoOpenCarriesTheFlag() passed after 0.006 seconds.
􁁛  Test contextCarriesConfigObjectsAndHostIdentity() passed after 0.006 seconds.
􁁛  Test legacySleepNamedTokensStillDecode() passed after 0.005 seconds.
􁁛  Test selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) with 5 test cases passed after 0.005 seconds.
􁁛  Test reseedRestoresDraftFromCommitted() passed after 0.005 seconds.
􁁛  Test hoverBarPresetAndCustomHexRoundTrip() passed after 0.005 seconds.
􁁛  Test contextRoundTripsThroughEncoding() passed after 0.006 seconds.
􁁛  Test sleepNilCommitRoundTripsAsGraphiteHex() passed after 0.005 seconds.
􁁛  Test pickerHexSelectsCustomAndCommits() passed after 0.005 seconds.
􁁛  Test lineBufferReassemblesSplitReads() passed after 0.006 seconds.
􁁛  Test incompleteOrInvalidHexDoesNotNormalize(input:) with 9 test cases passed after 0.005 seconds.
􁁛  Test choosingNoTintCommitsNilWithoutRequiringADraft() passed after 0.005 seconds.
􁁛  Test choicesAreNoneThenPresetsThenCustom() passed after 0.005 seconds.
􁁛  Test typingAPresetHexWhileCustomKeepsTheEditorOpen() passed after 0.005 seconds.
􁁛  Test sleepNamedTokensDisplayAsChips() passed after 0.005 seconds.
􁁛  Test displayedSleepNamedTokenIsNotTheStoredToken() passed after 0.005 seconds.
􁁛  Test customFromNoTintKeepsNilAndStaysEditable() passed after 0.005 seconds.
􁁛  Test normalOpenOmitsIncognitoOnTheWire() passed after 0.005 seconds.
􁁛  Test configBundleIdBeatsTheBuiltInTable() passed after 0.005 seconds.
􁁛  Test selectingGraphiteRewritesUnusableSleepTint(onDisk:) with 2 test cases passed after 0.005 seconds.
􁁛  Test sleepNilOrEmptyCommitStoresGraphiteHex() passed after 0.005 seconds.
􁁛  Test duplicateTargetsCollapse() passed after 0.005 seconds.
􁁛  Test completedHexNormalizes(input:expected:) with 4 test cases passed after 0.005 seconds.
􁁛  Test seedTreatsPresetHexAsThatChipNotCustom() passed after 0.005 seconds.
􁁛  Test launchOrderIsPrimaryFallbackThenInstalled() passed after 0.005 seconds.
􁁛  Test unknownSlugContributesNothing() passed after 0.005 seconds.
􁁛  Test unusableSleepTintIsNotCommittedGraphite() passed after 0.005 seconds.
􁁛  Test emptySlugsAreDropped() passed after 0.005 seconds.
􁁛  Test primaryThenFallbackThenOtherLiveHosts() passed after 0.005 seconds.
􁁛  Test tintWritePreservesUnknownFieldsAndStableEncoding() passed after 0.005 seconds.
􁁛  Test detectionNeedlesDoNotCrossMatch() passed after 0.006 seconds.
􁁛  Test needlePathResolvesToItsOwnSlug(slug:) with 22 test cases passed after 0.006 seconds.
􁁛  Test sleepPresetAndCustomHexRoundTrip() passed after 0.006 seconds.
􁁛  Test lilNapChoicesOmitNoTintAndKeepPresetOrder() passed after 0.005 seconds.
􁁛  Test primaryLeadsEvenWithNoLiveSockets() passed after 0.005 seconds.
􁁛  Test onlyAValidCompletedDraftCommits() passed after 0.005 seconds.
􁁛  Test emptyPartialAndInvalidDraftsKeepTheCommittedColor() passed after 0.005 seconds.
􁁛  Suite URLIntentTests passed after 0.008 seconds.
􁁛  Test openExternalDecodesDefensively() passed after 0.005 seconds.
􁁛  Suite ConfigDecodingTests passed after 0.008 seconds.
􁁛  Suite BrowserCatalogTests passed after 0.008 seconds.
􁁛  Test hoverBarNoTintRoundTripsAsOmittedKey() passed after 0.005 seconds.
􁁛  Suite PaletteRowsTests passed after 0.008 seconds.
􁁛  Suite ConfigMergeTests passed after 0.008 seconds.
􁁛  Suite SearchProviderTests passed after 0.008 seconds.
􁁛  Suite RoutingOrderTests passed after 0.008 seconds.
􁁛  Suite TintTests passed after 0.007 seconds.
􁁛  Suite PaletteOrderingTests passed after 0.008 seconds.
􁁛  Suite MessageTests passed after 0.008 seconds.
􁁛  Test protocolDocumentsEveryCatalogEntry() passed after 0.007 seconds.
􁁛  Suite BrowserTableTests passed after 0.008 seconds.
􁁛  Test profileDirectoriesAreNeverInstallTargets() passed after 0.013 seconds.
􁁛  Test missingInstallationsAreSkipped() passed after 0.021 seconds.
􁁛  Test writingManifestsCoversEveryExistingCatalogDir() passed after 0.101 seconds.
􁁛  Suite NativeHostManifestTests passed after 0.102 seconds.
􁁛  Test run with 123 tests in 12 suites passed after 0.102 seconds.
```

## Final `pnpm test`

22 pass, 0 fail. Fixtures untouched.

```
$ node --test extension/test/*.test.js
✔ fixture directory is repo-root fixtures, resolved from this file (0.779041ms)
✔ fixtures still resolve when cwd is not the repo root (0.28425ms)
✔ fixture path does not depend on HOME (0.116042ms)
✔ every shared contract fixture is readable as the same JSON object (1.319542ms)
✔ boots the production service worker, not a copy (4.754625ms)
✔ connects to the native host and asks for context (0.998833ms)
✔ context fixture lands as host identity plus config objects, with no bundle ids (2.726916ms)
✔ v1 config fixture yields the same additive defaults as the native suite (1.576375ms)
✔ v2 complete config fixture matches the context wire's config objects (1.724958ms)
✔ legacy open fixture creates a focused popup lil and registers it (2.136083ms)
✔ tab URL update is recorded on the lil registry (2.090625ms)
✔ resized lil updates registry bounds (1.407834ms)
✔ promoting a lil into a host tab moves it and drops the registry entry (1.760834ms)
✔ closing a focused lil removes it and focuses the prior window (2.062875ms)
✔ history-query replies with the shared history-result rows, including sparse ones (0.977833ms)
✔ promote to another browser posts open-external and removes the lil (1.202333ms)
✔ Send to lil from a normal window creates a focused popup and registers it (1.800291ms)
✔ sweep alarm is installed and a tick is harmless with no lils (0.981458ms)
✔ sleeping a lil stores a capture in IndexedDB and navigates to the sleep page (2.5655ms)
✔ unknown config fields are not required for the worker to apply known ones (1.082958ms)
✔ new-window target from a lil is re-parented into a cascaded lil (1.787167ms)
✔ suite runs without a live profile or the repo as cwd (1.053542ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 686.471292
```
