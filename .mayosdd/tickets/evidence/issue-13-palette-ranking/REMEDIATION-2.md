# Remediation round 2 — issue #13

Branch: `v0.4/issue-13-palette-ranking`
Worktree: `/Users/mygirleatsmayo/projects/lil-chromium-i13`
Scope: `mac/` only. `PaletteController.swift:429` unchanged.

## NA1

`autocompleteHost(for:)` (`PaletteModel.swift:48`) no longer calls `Ranking.rank(limit: 1)` when a row is promoted. For non-empty, non-URL text it reads `rows(for:)` (`:51`) and, if row 1 is `.history`, returns that host (`:52`). That is the same promotion `rows(for:)` already made via `bestEligibleIndex` (`:118`). No second ranking pass, no new helper.

When nothing is promoted (Search or Open leads), the old `rank(limit: 1)` path stays (`:55–58`). URL-like still yields `autocompleteHost: nil` on the Open row.

Test: `promotedRowAndTypeAheadNameTheSameHost` (`PaletteTests.swift:266`). Same `hub` fixture as SP1. Asserts kinds, action URLs, host `github.com`, and `autocompleteHost == rows[0].host`.

## Red then green

Command, from `mac/`:

```
swift test --filter promotedRowAndTypeAheadNameTheSameHost
```

**Red (test added, production still old):** type-ahead was `hubspot.com`; promoted row was `github.com`.

```
Building for debugging...
[1 / 5] LilShared
[2 / 6] LilShared
[8 / 11] LilChromiumApp-product
[10 / 14] LilChromiumApp
[11 / 15] LilChromiumApp
[19 / 23] LilChromiumTests-product
[21 / 25] LilChromiumTests-product
[28 / 30] LilChromiumTests-product
[31 / 35] lilchromium-host-product
Build complete! (3.21 sec)
􀟈  Test run started.
􀄵  Testing Library Version: 2074
􀄵  Target Platform: arm64e-apple-macos14.0
􀟈  Suite PaletteOrderingTests started.
􀟈  Test promotedRowAndTypeAheadNameTheSameHost() started.
􀢄  Test promotedRowAndTypeAheadNameTheSameHost() recorded an issue at PaletteTests.swift:277:9: Expectation failed: palette.autocompleteHost(for: "hub") == rows[0].host
􀄵  palette.autocompleteHost(for: "hub") == rows[0].host → false
􀄵    palette.autocompleteHost(for: "hub") → "hubspot.com"
􀄵      some → "hubspot.com"
􀄵    rows[0].host → "github.com"
􀄵      some → "github.com"
􀢄  Test promotedRowAndTypeAheadNameTheSameHost() failed after 0.001 seconds with 1 issue.
􀄵  /// NA1: the promoted row (github.com, more frecent) and the inline
􀄵  /// type-ahead host must be the same site. HubSpot is the higher-tier
􀄵  /// prefix; it stays below Search and must not become the ghost text.
􀢄  Suite PaletteOrderingTests failed after 0.001 seconds with 1 issue.
􀢄  Test run with 1 test in 1 suite failed after 0.001 seconds with 1 issue.
Note: Some test targets reported failures:
  - LilChromiumTests (Swift Testing)
```

**Green (after the `autocompleteHost` change):**

```
Building for debugging...
[2 / 5] LilChromiumApp-product
[3 / 6] LilChromiumApp-product
[5 / 9] LilChromiumApp
[6 / 10] LilChromiumApp
[11 / 15] LilChromiumApp-product
[13 / 16] LilChromiumApp-product
[16 / 19] LilChromiumApp
[19 / 20] LilChromiumTests-product
Build complete! (2.03 sec)
􀟈  Test run started.
􀄵  Testing Library Version: 2074
􀄵  Target Platform: arm64e-apple-macos14.0
􀟈  Suite PaletteOrderingTests started.
􀟈  Test promotedRowAndTypeAheadNameTheSameHost() started.
􁁛  Test promotedRowAndTypeAheadNameTheSameHost() passed after 0.001 seconds.
􁁛  Suite PaletteOrderingTests passed after 0.001 seconds.
􁁛  Test run with 1 test in 1 suite passed after 0.001 seconds.
```

## Final `swift test`

124 tests in 12 suites (123 before the new case).

```
Building for debugging...
Build complete! (0.21 sec)
Test Suite 'All tests' started at 2026-08-18 16:37:40.246.
Test Suite 'All tests' passed at 2026-08-18 16:37:40.247.
	 Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.001) seconds
􀟈  Test run started.
􀄵  Testing Library Version: 2074
􀄵  Target Platform: arm64e-apple-macos14.0
􀟈  Suite TintTests started.
􀟈  Suite URLIntentTests started.
􀟈  Suite PaletteRowsTests started.
􀟈  Suite PaletteOrderingTests started.
􀟈  Suite MessageTests started.
􀟈  Suite BrowserTableTests started.
􀟈  Suite SearchProviderTests started.
􀟈  Suite RoutingOrderTests started.
􀟈  Suite NativeHostManifestTests started.
􀟈  Suite ConfigMergeTests started.
􀟈  Suite ConfigDecodingTests started.
􀟈  Test typingAPresetHexWhileCustomKeepsTheEditorOpen() started.
􀟈  Test seedTreatsPresetHexAsThatChipNotCustom() started.
􀟈  Test hoverBarPresetAndCustomHexRoundTrip() started.
􀟈  Test displayHostDropsWWWAndFailsClosed() started.
􀟈  Test sleepNilCommitRoundTripsAsGraphiteHex() started.
􀟈  Test legacySleepNamedTokensStillDecode() started.
􀟈  Test configuredSearchEngineIsUsed() started.
􀟈  Test searchTemplateTrimsTheQuery() started.
􀟈  Test presetCommitIsThatPresetsHex() started.
􀟈  Test normalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() started.
􀟈  Test lilNapChoicesOmitNoTintAndKeepPresetOrder() started.
􀟈  Test hoverBarNilIsNoTint() started.
􀟈  Test onlyAValidCompletedDraftCommits() started.
􀟈  Test partialSiteNameRanksTheOriginFirst() started.
􀟈  Test everythingElseIsAQuery() started.
􀟈  Test choosingNoTintCommitsNilWithoutRequiringADraft() started.
􀟈  Test selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Suite BrowserCatalogTests started.
􀟈  Test incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test oneSiteCannotFloodTheList() started.
􀟈  Test hoverBarNoTintRoundTripsAsOmittedKey() started.
􀟈  Test emptyQueryListsFrequentSitesWithoutASearchRow() started.
􀟈  Test envelopeDecodesAnyMessageForDispatch() started.
􀟈  Test templateWithoutPlaceholderFallsBackToDefault() started.
􀟈  Test emptyPartialAndInvalidDraftsKeepTheCommittedColor() started.
􀟈  Test sleepNamedTokensDisplayAsChips() started.
􀟈  Test sleepPresetAndCustomHexRoundTrip() started.
􀟈  Test searchTemplateSubstitutesTheEncodedQuery() started.
􀟈  Test textWithASchemeOrADotIsADestination() started.
􀟈  Test normalOpenOmitsIncognitoOnTheWire() started.
􀟈  Test searchRowFollowsTheTopHit() started.
􀟈  Test customFromNoTintKeepsNilAndStaysEditable() started.
􀟈  Test choicesAreNoneThenPresetsThenCustom() started.
􀟈  Test autocompleteOffersOnlyAPrefixedHost() started.
􀟈  Test urlInputLeadsWithAnOpenRow() started.
􀟈  Test pickerHexSelectsCustomAndCommits() started.
􀟈  Test frecencyNotTierChoosesAmongEligibleDomains() started.
􀟈  Test reseedRestoresDraftFromCommitted() started.
􀟈  Test nearDuplicatePagesShowOnce() started.
􀟈  Test historyResultToleratesSparseRows() started.
􀟈  Test contextRoundTripsThroughEncoding() started.
􀟈  Test openExternalDecodesDefensively() started.
􀟈  Test completedHexNormalizes(input:expected:) started.
􀟈  Test legacyPongDefaultsToUnknownBrowser() started.
􀟈  Test registrableDomainInteriorMatchLeadsSearch() started.
􀟈  Test sleepNilOrEmptyCommitStoresGraphiteHex() started.
􀟈  Test bareTLDQueryFallsToSearch() started.
􀟈  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() started.
􀟈  Test legacyOpenDecodesWithoutIncognito() started.
􀟈  Test frecencyBreaksTiesBetweenEligibleDomains() started.
􀟈  Test selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test tintWritePreservesUnknownFieldsAndStableEncoding() started.
􀟈  Test lineBufferReassemblesSplitReads() started.
􀟈  Test promotedRowAndTypeAheadNameTheSameHost() started.
􀟈  Test unrelatedURLTextStaysBelowSearch() started.
􀟈  Test registrableDomainPrefixLeadsSearch() started.
􀟈  Test registrableLabelMatchStillPromotes() started.
􀟈  Test displayedSleepNamedTokenIsNotTheStoredToken() started.
􀟈  Test duplicatesAndPerHostCapDoNotDependOnHistoryOrder() started.
􀟈  Test unmatchedQueryOffersOnlySearch() started.
􀟈  Test unusableSleepTintIsNotCommittedGraphite() started.
􀟈  Test incognitoOpenCarriesTheFlag() started.
􀟈  Test existingNamedProviderStaysExplicit() started.
􀟈  Test chromeStableHelperPathIsChrome() started.
􀟈  Test decodeLineToleratesTheTrailingNewline() started.
􀟈  Test contextCarriesConfigObjectsAndHostIdentity() started.
􀟈  Test siblingChannelsRemainSeparateInstallations() started.
􀟈  Test pathOnlyMatchStaysBelowSearch() started.
􀟈  Test whitelistOpDecodesDefensively() started.
􀟈  Test queryStringOnlyMatchStaysBelowSearch() started.
􀟈  Test profilesAreNotRoutingTargets() started.
􀟈  Test unmatchedTextLeadsWithSearch() started.
􀟈  Test settingsOffersTheSixProvidersInOrder() started.
􀟈  Test validTemplatesSubstituteTheEncodedQuery() started.
􀟈  Test encodingExistingConfigWritesInferredProvider() started.
􀟈  Test subdomainOnlyMatchStaysBelowSearch() started.
􀟈  Test detectionNeedlesDoNotCrossMatch() started.
􀟈  Test configBundleIdBeatsTheBuiltInTable() started.
􀟈  Test everyInstallationHasStableIdentity() started.
􀟈  Test catalogIsTheFullSupportedSet() started.
􀟈  Test routingIdentitiesAreUnique() started.
􀟈  Test titleOnlyMatchStaysBelowSearch() started.
􀟈  Test unknownSlugContributesNothing() started.
􀟈  Test needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test encodedLineIsCompactAndNewlineTerminated() started.
􀟈  Test primaryLeadsEvenWithNoLiveSockets() started.
􀟈  Test urlInputKeepsOpenThenSearchAhead() started.
􀟈  Test storedProviderIsNotInferredFromTemplate() started.
􀟈  Test chromeBetaHelperPathIsNotChromeStable() started.
􀟈  Test validCustomDraftCommitsTheTemplate() started.
􀟈  Test denseFuzzyMatchOutranksAScatteredOne() started.
􀟈  Test emptySlugsAreDropped() started.
􀟈  Test selectingCustomStaysCustomWithFieldVisible() started.
􀟈  Test primaryThenFallbackThenOtherLiveHosts() started.
􀟈  Test unmatchedParentIsUnknown() started.
􀟈  Test duplicateTargetsCollapse() started.
􀟈  Test launchOrderIsPrimaryFallbackThenInstalled() started.
􀟈  Test writingManifestsCoversEveryExistingCatalogDir() started.
􀟈  Test encodingProviderPreservesUnknownTopLevelFields() started.
􀟈  Test switchingPresetsDoesNotOverwriteACustomDraft() started.
􀟈  Test profileDirectoriesAreNeverInstallTargets() started.
􀟈  Test invalidCustomDraftStaysVisibleAndDoesNotCommit() started.
􀟈  Test installScriptListsTheFullCatalog() started.
􀟈  Test missingSearchEngineDefaultsToStartpage() started.
􀟈  Test protocolDocumentsEveryCatalogEntry() started.
􀟈  Test missingInstallationsAreSkipped() started.
􀟈  Test unchangedSaveKeepsUnknownFieldsVerbatim() started.
􀟈  Test case passing 1 argument input → "" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument input → "#" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#f" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument onDisk → "gray" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test saveOverCorruptFileStillWrites() started.
􀟈  Test case passing 1 argument input → "#ff" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test whitelistOpOnFreshFileSeedsDefaults() started.
􀟈  Test whitelistRemoveDropsTheDomain() started.
􀟈  Test case passing 1 argument input → "#fff0" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#gggggg" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument onDisk → "grey" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test savePreservesUnknownTopLevelFields() started.
􀟈  Test case passing 1 argument input → "ff00aa" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument onDisk → "purple" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument input → "#ff00aag" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument onDisk → "#8e8e93" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test normalizedDomainReducesInputToABareHost() started.
􀟈  Test case passing 1 argument input → "purple" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument onDisk → "#3311aa" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test saveFromNoExistingFileWritesTheConfig() started.
􀟈  Test absentHoverBarTintIsOmittedNotNull() started.
􀟈  Test whitelistAddIsIdempotent() started.
􀟈  Test whitelistOpRejectsUnknownOpAndEmptyDomain() started.
􀟈  Test whitelistAddPreservesEverythingElse() started.
􀟈  Test writtenBytesAreSortedAndStable() started.
􀟈  Test case passing 2 arguments input → "#f0a", expected → "#ff00aa" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "#FF00AA", expected → "#ff00aa" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "  #00ff00  ", expected → "#00ff00" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "#007aff", expected → "#007aff" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 1 argument onDisk → "none" to selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "" to selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test completeConfigDecodesVerbatim() started.
􀟈  Test legacyConfigGetsAdditiveDefaults() started.
􀟈  Test case passing 1 argument slug → "chrome" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chrome-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chrome-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chrome-canary" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-nightly" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "edge" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "edge-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "edge-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􁁛  Test typingAPresetHexWhileCustomKeepsTheEditorOpen() passed after 0.003 seconds.
􀟈  Test case passing 1 argument slug → "edge-canary" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "vivaldi" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "vivaldi-snapshot" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera-gx" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera-developer" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "helium" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "arc" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "dia" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "comet" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chromium" to needlePathResolvesToItsOwnSlug(slug:) started.
􁁛  Test presetCommitIsThatPresetsHex() passed after 0.003 seconds.
􁁛  Test normalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() passed after 0.003 seconds.
􁁛  Test displayHostDropsWWWAndFailsClosed() passed after 0.004 seconds.
􁁛  Test lilNapChoicesOmitNoTintAndKeepPresetOrder() passed after 0.004 seconds.
􁁛  Test everythingElseIsAQuery() passed after 0.004 seconds.
􀟈  Test unavailableInstallationsAreNotOfferedAsChoices() started.
􀟈  Test mergedReplacesKnownBrowsersWithTheFullScan() started.
􀟈  Test isInstalledReadsTheCatalogFlag() started.
􀟈  Test scanKeepsUnavailableInstallations() started.
􁁛  Test seedTreatsPresetHexAsThatChipNotCustom() passed after 0.004 seconds.
􁁛  Test hoverBarNilIsNoTint() passed after 0.004 seconds.
􁁛  Test choosingNoTintCommitsNilWithoutRequiringADraft() passed after 0.004 seconds.
􁁛  Test searchTemplateTrimsTheQuery() passed after 0.004 seconds.
􁁛  Test onlyAValidCompletedDraftCommits() passed after 0.004 seconds.
􁁛  Test incompleteOrInvalidHexDoesNotNormalize(input:) with 9 test cases passed after 0.004 seconds.
􀟈  Test case passing 1 argument id → "google" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument id → "ddg" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument id → "bing" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument id → "kagi" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument id → "startpage" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􁁛  Test legacySleepNamedTokensStillDecode() passed after 0.004 seconds.
􁁛  Test selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) with 5 test cases passed after 0.005 seconds.
􁁛  Test envelopeDecodesAnyMessageForDispatch() passed after 0.005 seconds.
􁁛  Test templateWithoutPlaceholderFallsBackToDefault() passed after 0.005 seconds.
􁁛  Test emptyPartialAndInvalidDraftsKeepTheCommittedColor() passed after 0.005 seconds.
􁁛  Test sleepNamedTokensDisplayAsChips() passed after 0.005 seconds.
􁁛  Test configuredSearchEngineIsUsed() passed after 0.005 seconds.
􁁛  Test searchTemplateSubstitutesTheEncodedQuery() passed after 0.005 seconds.
􁁛  Test textWithASchemeOrADotIsADestination() passed after 0.005 seconds.
􁁛  Test choicesAreNoneThenPresetsThenCustom() passed after 0.005 seconds.
􁁛  Test normalOpenOmitsIncognitoOnTheWire() passed after 0.005 seconds.
􁁛  Test oneSiteCannotFloodTheList() passed after 0.005 seconds.
􁁛  Test pickerHexSelectsCustomAndCommits() passed after 0.005 seconds.
􁁛  Test partialSiteNameRanksTheOriginFirst() passed after 0.005 seconds.
􁁛  Test reseedRestoresDraftFromCommitted() passed after 0.005 seconds.
􁁛  Test frecencyNotTierChoosesAmongEligibleDomains() passed after 0.005 seconds.
􁁛  Test searchRowFollowsTheTopHit() passed after 0.005 seconds.
􁁛  Test openExternalDecodesDefensively() passed after 0.005 seconds.
􁁛  Test legacyPongDefaultsToUnknownBrowser() passed after 0.005 seconds.
􁁛  Test completedHexNormalizes(input:expected:) with 4 test cases passed after 0.005 seconds.
􁁛  Test historyResultToleratesSparseRows() passed after 0.005 seconds.
􁁛  Test sleepNilOrEmptyCommitStoresGraphiteHex() passed after 0.005 seconds.
􁁛  Test emptyQueryListsFrequentSitesWithoutASearchRow() passed after 0.005 seconds.
􁁛  Test nearDuplicatePagesShowOnce() passed after 0.005 seconds.
􁁛  Test bareTLDQueryFallsToSearch() passed after 0.005 seconds.
􁁛  Test registrableDomainInteriorMatchLeadsSearch() passed after 0.005 seconds.
􁁛  Test legacyOpenDecodesWithoutIncognito() passed after 0.005 seconds.
􁁛  Test frecencyBreaksTiesBetweenEligibleDomains() passed after 0.005 seconds.
􁁛  Test selectingGraphiteRewritesUnusableSleepTint(onDisk:) with 2 test cases passed after 0.005 seconds.
􁁛  Test urlInputLeadsWithAnOpenRow() passed after 0.005 seconds.
􁁛  Test unrelatedURLTextStaysBelowSearch() passed after 0.005 seconds.
􁁛  Test customFromNoTintKeepsNilAndStaysEditable() passed after 0.005 seconds.
􁁛  Test registrableLabelMatchStillPromotes() passed after 0.005 seconds.
􁁛  Test registrableDomainPrefixLeadsSearch() passed after 0.005 seconds.
􁁛  Test unusableSleepTintIsNotCommittedGraphite() passed after 0.005 seconds.
􁁛  Test incognitoOpenCarriesTheFlag() passed after 0.005 seconds.
􁁛  Test eligibleMatchIsNotEvictedByIneligiblePrefixRows() passed after 0.005 seconds.
􁁛  Test duplicatesAndPerHostCapDoNotDependOnHistoryOrder() passed after 0.005 seconds.
􁁛  Test contextRoundTripsThroughEncoding() passed after 0.005 seconds.
􁁛  Test lineBufferReassemblesSplitReads() passed after 0.005 seconds.
􁁛  Test existingNamedProviderStaysExplicit() passed after 0.005 seconds.
􁁛  Test pathOnlyMatchStaysBelowSearch() passed after 0.005 seconds.
􁁛  Test chromeStableHelperPathIsChrome() passed after 0.005 seconds.
􁁛  Test unmatchedTextLeadsWithSearch() passed after 0.005 seconds.
􁁛  Test displayedSleepNamedTokenIsNotTheStoredToken() passed after 0.005 seconds.
􁁛  Test autocompleteOffersOnlyAPrefixedHost() passed after 0.005 seconds.
􁁛  Test whitelistOpDecodesDefensively() passed after 0.005 seconds.
􁁛  Test promotedRowAndTypeAheadNameTheSameHost() passed after 0.005 seconds.
􁁛  Test settingsOffersTheSixProvidersInOrder() passed after 0.005 seconds.
􁁛  Test configBundleIdBeatsTheBuiltInTable() passed after 0.005 seconds.
􁁛  Test decodeLineToleratesTheTrailingNewline() passed after 0.005 seconds.
􁁛  Test unmatchedQueryOffersOnlySearch() passed after 0.005 seconds.
􁁛  Test contextCarriesConfigObjectsAndHostIdentity() passed after 0.005 seconds.
􁁛  Test validTemplatesSubstituteTheEncodedQuery() passed after 0.005 seconds.
􁁛  Test catalogIsTheFullSupportedSet() passed after 0.005 seconds.
􁁛  Test queryStringOnlyMatchStaysBelowSearch() passed after 0.005 seconds.
􁁛  Test subdomainOnlyMatchStaysBelowSearch() passed after 0.005 seconds.
􁁛  Test siblingChannelsRemainSeparateInstallations() passed after 0.005 seconds.
􁁛  Test encodedLineIsCompactAndNewlineTerminated() passed after 0.005 seconds.
􁁛  Test routingIdentitiesAreUnique() passed after 0.005 seconds.
􁁛  Test primaryLeadsEvenWithNoLiveSockets() passed after 0.005 seconds.
􁁛  Test validCustomDraftCommitsTheTemplate() passed after 0.005 seconds.
􁁛  Test encodingExistingConfigWritesInferredProvider() passed after 0.005 seconds.
􁁛  Test everyInstallationHasStableIdentity() passed after 0.005 seconds.
􁁛  Test titleOnlyMatchStaysBelowSearch() passed after 0.005 seconds.
􁁛  Test emptySlugsAreDropped() passed after 0.005 seconds.
􁁛  Test selectingCustomStaysCustomWithFieldVisible() passed after 0.005 seconds.
􁁛  Test unknownSlugContributesNothing() passed after 0.005 seconds.
􁁛  Test storedProviderIsNotInferredFromTemplate() passed after 0.005 seconds.
􁁛  Test denseFuzzyMatchOutranksAScatteredOne() passed after 0.005 seconds.
􁁛  Test needlePathResolvesToItsOwnSlug(slug:) with 22 test cases passed after 0.005 seconds.
􁁛  Test duplicateTargetsCollapse() passed after 0.005 seconds.
􁁛  Test urlInputKeepsOpenThenSearchAhead() passed after 0.005 seconds.
􁁛  Test primaryThenFallbackThenOtherLiveHosts() passed after 0.005 seconds.
􁁛  Test profilesAreNotRoutingTargets() passed after 0.005 seconds.
􁁛  Test switchingPresetsDoesNotOverwriteACustomDraft() passed after 0.005 seconds.
􁁛  Test launchOrderIsPrimaryFallbackThenInstalled() passed after 0.005 seconds.
􁁛  Test unmatchedParentIsUnknown() passed after 0.005 seconds.
􁁛  Test invalidCustomDraftStaysVisibleAndDoesNotCommit() passed after 0.005 seconds.
􁁛  Test missingSearchEngineDefaultsToStartpage() passed after 0.005 seconds.
􁁛  Test detectionNeedlesDoNotCrossMatch() passed after 0.005 seconds.
􁁛  Test chromeBetaHelperPathIsNotChromeStable() passed after 0.005 seconds.
􁁛  Test installScriptListsTheFullCatalog() passed after 0.005 seconds.
􁁛  Test saveOverCorruptFileStillWrites() passed after 0.004 seconds.
􁁛  Test selectingAPresetWritesItsNameAndTemplate(id:) with 5 test cases passed after 0.005 seconds.
􁁛  Test hoverBarNoTintRoundTripsAsOmittedKey() passed after 0.006 seconds.
􁁛  Test unchangedSaveKeepsUnknownFieldsVerbatim() passed after 0.005 seconds.
􁁛  Test sleepNilCommitRoundTripsAsGraphiteHex() passed after 0.006 seconds.
􁁛  Test tintWritePreservesUnknownFieldsAndStableEncoding() passed after 0.006 seconds.
􁁛  Test normalizedDomainReducesInputToABareHost() passed after 0.004 seconds.
􁁛  Test savePreservesUnknownTopLevelFields() passed after 0.004 seconds.
􁁛  Test absentHoverBarTintIsOmittedNotNull() passed after 0.004 seconds.
􁁛  Test whitelistOpOnFreshFileSeedsDefaults() passed after 0.005 seconds.
􁁛  Test whitelistRemoveDropsTheDomain() passed after 0.005 seconds.
􁁛  Test encodingProviderPreservesUnknownTopLevelFields() passed after 0.005 seconds.
􁁛  Test hoverBarPresetAndCustomHexRoundTrip() passed after 0.006 seconds.
􁁛  Test whitelistOpRejectsUnknownOpAndEmptyDomain() passed after 0.004 seconds.
􁁛  Test sleepPresetAndCustomHexRoundTrip() passed after 0.006 seconds.
􁁛  Test whitelistAddPreservesEverythingElse() passed after 0.004 seconds.
􁁛  Test saveFromNoExistingFileWritesTheConfig() passed after 0.004 seconds.
􁁛  Test writtenBytesAreSortedAndStable() passed after 0.004 seconds.
􁁛  Test whitelistAddIsIdempotent() passed after 0.004 seconds.
􁁛  Test legacyConfigGetsAdditiveDefaults() passed after 0.003 seconds.
􁁛  Test completeConfigDecodesVerbatim() passed after 0.003 seconds.
􁁛  Suite URLIntentTests passed after 0.006 seconds.
􁁛  Test unavailableInstallationsAreNotOfferedAsChoices() passed after 0.002 seconds.
􁁛  Test mergedReplacesKnownBrowsersWithTheFullScan() passed after 0.002 seconds.
􁁛  Suite MessageTests passed after 0.006 seconds.
􁁛  Suite PaletteRowsTests passed after 0.006 seconds.
􁁛  Suite PaletteOrderingTests passed after 0.006 seconds.
􁁛  Test isInstalledReadsTheCatalogFlag() passed after 0.002 seconds.
􁁛  Suite RoutingOrderTests passed after 0.006 seconds.
􁁛  Test scanKeepsUnavailableInstallations() passed after 0.002 seconds.
􁁛  Suite SearchProviderTests passed after 0.006 seconds.
􁁛  Suite ConfigMergeTests passed after 0.006 seconds.
􁁛  Suite ConfigDecodingTests passed after 0.006 seconds.
􁁛  Suite TintTests passed after 0.007 seconds.
􁁛  Suite BrowserCatalogTests passed after 0.006 seconds.
􁁛  Test protocolDocumentsEveryCatalogEntry() passed after 0.006 seconds.
􁁛  Suite BrowserTableTests passed after 0.007 seconds.
􁁛  Test profileDirectoriesAreNeverInstallTargets() passed after 0.013 seconds.
􁁛  Test missingInstallationsAreSkipped() passed after 0.021 seconds.
􁁛  Test writingManifestsCoversEveryExistingCatalogDir() passed after 0.099 seconds.
􁁛  Suite NativeHostManifestTests passed after 0.100 seconds.
􁁛  Test run with 124 tests in 12 suites passed after 0.100 seconds.
```

## Final `pnpm test`

22 pass, 0 fail. Fixtures untouched.

```
$ node --test extension/test/*.test.js
✔ fixture directory is repo-root fixtures, resolved from this file (1.170459ms)
✔ fixtures still resolve when cwd is not the repo root (0.435209ms)
✔ fixture path does not depend on HOME (0.098541ms)
✔ every shared contract fixture is readable as the same JSON object (2.216041ms)
✔ boots the production service worker, not a copy (6.033375ms)
✔ connects to the native host and asks for context (0.95875ms)
✔ context fixture lands as host identity plus config objects, with no bundle ids (2.103292ms)
✔ v1 config fixture yields the same additive defaults as the native suite (1.207416ms)
✔ v2 complete config fixture matches the context wire's config objects (1.356792ms)
✔ legacy open fixture creates a focused popup lil and registers it (2.2035ms)
✔ tab URL update is recorded on the lil registry (2.428625ms)
✔ resized lil updates registry bounds (1.693459ms)
✔ promoting a lil into a host tab moves it and drops the registry entry (2.035333ms)
✔ closing a focused lil removes it and focuses the prior window (2.2815ms)
✔ history-query replies with the shared history-result rows, including sparse ones (1.4715ms)
✔ promote to another browser posts open-external and removes the lil (1.8955ms)
✔ Send to lil from a normal window creates a focused popup and registers it (1.915292ms)
✔ sweep alarm is installed and a tick is harmless with no lils (1.09275ms)
✔ sleeping a lil stores a capture in IndexedDB and navigates to the sleep page (3.133542ms)
✔ unknown config fields are not required for the worker to apply known ones (1.14175ms)
✔ new-window target from a lil is re-parented into a cascaded lil (1.862584ms)
✔ suite runs without a live profile or the repo as cwd (1.198583ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 691.472416
```
