# Remediation round 1 — Issue #5

Branch: `v0.4/issue-5-lil-lifecycle`
Code commit: `a7747a3` — `fix(extension): remediate round-1 review ledger on lil lifecycle`

Comment text, identifier names, and two assertion/comment strings only. Focus behavior, `type: "popup"` API usage, and the dual URL guard are unchanged. Nothing outside `extension/background.js` and `extension/test/worker.test.js` was touched. Did not stop.

## Ledger rows

| ID | Status | What changed |
|---|---|---|
| S1 | resolved | `extension/background.js:253-255` now says focused lil creates get an explicit `focusWindow()` because `create({focused:true})` is unreliable on macOS (`research §Focus`), and that unfocused creates (`restoreWindows`) skip it. `extension/background.js:287` now says `focusWindow` is used after `windows.create` when a lil is asked to take focus. Focus behavior was not changed. |
| S2 | resolved | `spec.record` renamed `spec.recordUrl` (a URL, not a registry record) at `extension/background.js:545` (JSDoc), `:587` (read), `:670` (`restoreWindows`), `:793` (`cascadeTabToLil`). `cascadeOrigin(windowId, fallback)` parameter renamed `unpositionedCoord` at `:597` (signature), `:594-596` (comment), `:599` (use). `openIncognitoLil`'s `fallback` function at `:613` left alone. |
| S3 | resolved | `extension/background.js:789` comment is now "offset lil" (was "offset popup lil"). `extension/test/worker.test.js:385` assertion message is now "incognito open creates an incognito lil". `assert.equal(secret.type, "popup")` on the next line is unchanged. |

Settled won't-touch (not acted on): S4 URL-guard duplication; unfocused restore; `type: "popup"` in code; `registerWindow`'s unreachable `prev` merge.

## Verification

`pnpm test` — 28/28 pass.

```
$ node --test extension/test/*.test.js
✔ fixture directory is repo-root fixtures, resolved from this file (0.831709ms)
✔ fixtures still resolve when cwd is not the repo root (0.243625ms)
✔ fixture path does not depend on HOME (0.090333ms)
✔ every shared contract fixture is readable as the same JSON object (0.836708ms)
✔ boots the production service worker, not a copy (5.150333ms)
✔ connects to the native host and asks for context (1.087166ms)
✔ context fixture lands as host identity plus config objects, with no bundle ids (1.938459ms)
✔ v1 config fixture yields the same additive defaults as the native suite (1.50025ms)
✔ v2 complete config fixture matches the context wire's config objects (1.242208ms)
✔ legacy open fixture creates a focused popup lil and registers it (1.80125ms)
✔ tab URL update is recorded on the lil registry (1.977708ms)
✔ resized lil updates registry bounds (1.47925ms)
✔ promoting a lil into a host tab moves it and drops the registry entry (1.931292ms)
✔ closing a focused lil removes it and focuses the prior window (2.0805ms)
✔ history-query replies with the shared history-result rows, including sparse ones (1.06675ms)
✔ promote to another browser posts open-external and removes the lil (1.755084ms)
✔ Send to lil from a normal window creates a focused popup and registers it (1.882208ms)
✔ sweep alarm is installed and a tick is harmless with no lils (0.951875ms)
✔ sleeping a lil stores a capture in IndexedDB and navigates to the sleep page (2.42325ms)
✔ unknown config fields are not required for the worker to apply known ones (1.0195ms)
✔ new-window target from a lil is re-parented into a cascaded lil (1.726542ms)
✔ restart restoration reopens parked lils unfocused, skips quit-expiry ones, and re-registers them (1.052625ms)
✔ an incognito lil is focused, in-memory only, and never restored (2.30425ms)
✔ without incognito access the incognito path falls back to a normal lil and hints why (1.922875ms)
✔ a failed lil creation registers nothing (2.072084ms)
✔ a failed incognito creation falls back to exactly one registered normal lil (1.078375ms)
✔ geometry maintenance never requests focus (1.3445ms)
✔ suite runs without a live profile or the repo as cwd (1.030166ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 681.967625
```

`swift test` in `mac/` — 107/107 pass.

```
Building for debugging...
[1 / 3]
Build complete! (0.35 sec)
Test Suite 'All tests' started at 2026-08-18 15:48:06.604.
Test Suite 'All tests' passed at 2026-08-18 15:48:06.605.
	 Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.001) seconds
􀟈  Test run started.
􀄵  Testing Library Version: 2074
􀄵  Target Platform: arm64e-apple-macos14.0
􀟈  Suite BrowserCatalogTests started.
􀟈  Suite ConfigDecodingTests started.
􀟈  Suite SearchProviderTests started.
􀟈  Suite NativeHostManifestTests started.
􀟈  Suite TintTests started.
􀟈  Suite RoutingOrderTests started.
􀟈  Suite ConfigMergeTests started.
􀟈  Suite BrowserTableTests started.
􀟈  Test completeConfigDecodesVerbatim() started.
􀟈  Test writingManifestsCoversEveryExistingCatalogDir() started.
􀟈  Test profileDirectoriesAreNeverInstallTargets() started.
􀟈  Test validCustomDraftCommitsTheTemplate() started.
􀟈  Suite MessageTests started.
􀟈  Test switchingPresetsDoesNotOverwriteACustomDraft() started.
􀟈  Test settingsOffersTheSixProvidersInOrder() started.
􀟈  Suite PaletteRowsTests started.
􀟈  Test legacyConfigGetsAdditiveDefaults() started.
􀟈  Test invalidCustomDraftStaysVisibleAndDoesNotCommit() started.
􀟈  Test encodingProviderPreservesUnknownTopLevelFields() started.
􀟈  Test encodingExistingConfigWritesInferredProvider() started.
􀟈  Test installScriptListsTheFullCatalog() started.
􀟈  Test missingInstallationsAreSkipped() started.
􀟈  Test hoverBarNoTintRoundTripsAsOmittedKey() started.
􀟈  Test validTemplatesSubstituteTheEncodedQuery() started.
􀟈  Suite URLIntentTests started.
􀟈  Test missingSearchEngineDefaultsToStartpage() started.
􀟈  Test storedProviderIsNotInferredFromTemplate() started.
􀟈  Test choicesAreNoneThenPresetsThenCustom() started.
􀟈  Test incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test sleepNilOrEmptyCommitStoresGraphiteHex() started.
􀟈  Test emptyPartialAndInvalidDraftsKeepTheCommittedColor() started.
􀟈  Test selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test completedHexNormalizes(input:expected:) started.
􀟈  Test selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test presetCommitIsThatPresetsHex() started.
􀟈  Test existingNamedProviderStaysExplicit() started.
􀟈  Test pickerHexSelectsCustomAndCommits() started.
􀟈  Test needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test typingAPresetHexWhileCustomKeepsTheEditorOpen() started.
􀟈  Test unmatchedParentIsUnknown() started.
􀟈  Test saveOverCorruptFileStillWrites() started.
􀟈  Test sleepNamedTokensDisplayAsChips() started.
􀟈  Test emptySlugsAreDropped() started.
􀟈  Test lilNapChoicesOmitNoTintAndKeepPresetOrder() started.
􀟈  Test legacySleepNamedTokensStillDecode() started.
􀟈  Test whitelistAddPreservesEverythingElse() started.
􀟈  Test hoverBarNilIsNoTint() started.
􀟈  Test whitelistRemoveDropsTheDomain() started.
􀟈  Test siblingChannelsRemainSeparateInstallations() started.
􀟈  Test seedTreatsPresetHexAsThatChipNotCustom() started.
􀟈  Test selectingCustomStaysCustomWithFieldVisible() started.
􀟈  Test whitelistAddIsIdempotent() started.
􀟈  Test catalogIsTheFullSupportedSet() started.
􀟈  Test chromeBetaHelperPathIsNotChromeStable() started.
􀟈  Test displayedSleepNamedTokenIsNotTheStoredToken() started.
􀟈  Test writtenBytesAreSortedAndStable() started.
􀟈  Test selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test everyInstallationHasStableIdentity() started.
􀟈  Test reseedRestoresDraftFromCommitted() started.
􀟈  Test primaryLeadsEvenWithNoLiveSockets() started.
􀟈  Test launchOrderIsPrimaryFallbackThenInstalled() started.
􀟈  Test unusableSleepTintIsNotCommittedGraphite() started.
􀟈  Test hoverBarPresetAndCustomHexRoundTrip() started.
􀟈  Test sleepPresetAndCustomHexRoundTrip() started.
􀟈  Test duplicateTargetsCollapse() started.
􀟈  Test whitelistOpRejectsUnknownOpAndEmptyDomain() started.
􀟈  Test tintWritePreservesUnknownFieldsAndStableEncoding() started.
􀟈  Test configBundleIdBeatsTheBuiltInTable() started.
􀟈  Test detectionNeedlesDoNotCrossMatch() started.
􀟈  Test unknownSlugContributesNothing() started.
􀟈  Test protocolDocumentsEveryCatalogEntry() started.
􀟈  Test customFromNoTintKeepsNilAndStaysEditable() started.
􀟈  Test primaryThenFallbackThenOtherLiveHosts() started.
􀟈  Test routingIdentitiesAreUnique() started.
􀟈  Test choosingNoTintCommitsNilWithoutRequiringADraft() started.
􀟈  Test normalizedDomainReducesInputToABareHost() started.
􀟈  Test profilesAreNotRoutingTargets() started.
􀟈  Test onlyAValidCompletedDraftCommits() started.
􀟈  Test sleepNilCommitRoundTripsAsGraphiteHex() started.
􀟈  Test chromeStableHelperPathIsChrome() started.
􀟈  Test saveFromNoExistingFileWritesTheConfig() started.
􀟈  Test unchangedSaveKeepsUnknownFieldsVerbatim() started.
􀟈  Test whitelistOpOnFreshFileSeedsDefaults() started.
􀟈  Test savePreservesUnknownTopLevelFields() started.
􀟈  Test absentHoverBarTintIsOmittedNotNull() started.
􀟈  Test case passing 1 argument input → "#" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#f" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#ff" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#fff0" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#gggggg" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "ff00aa" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "#ff00aag" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test case passing 1 argument input → "purple" to incompleteOrInvalidHexDoesNotNormalize(input:) started.
􀟈  Test mergedReplacesKnownBrowsersWithTheFullScan() started.
􀟈  Test scanKeepsUnavailableInstallations() started.
􀟈  Test unavailableInstallationsAreNotOfferedAsChoices() started.
􀟈  Test isInstalledReadsTheCatalogFlag() started.
􀟈  Test case passing 2 arguments input → "#FF00AA", expected → "#ff00aa" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "  #00ff00  ", expected → "#00ff00" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 1 argument onDisk → "" to selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test case passing 2 arguments input → "#f0a", expected → "#ff00aa" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 2 arguments input → "#007aff", expected → "#007aff" to completedHexNormalizes(input:expected:) started.
􀟈  Test case passing 1 argument id → "google" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument slug → "chrome" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument id → "ddg" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument onDisk → "none" to selectingGraphiteRewritesUnusableSleepTint(onDisk:) started.
􀟈  Test case passing 1 argument slug → "chrome-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chrome-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test contextCarriesConfigObjectsAndHostIdentity() started.
􀟈  Test case passing 1 argument id → "bing" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument slug → "chrome-canary" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument id → "kagi" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument slug → "brave-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "brave-nightly" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument id → "startpage" to selectingAPresetWritesItsNameAndTemplate(id:) started.
􀟈  Test case passing 1 argument slug → "edge" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test normalOpenOmitsIncognitoOnTheWire() started.
􀟈  Test case passing 1 argument slug → "edge-beta" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test contextRoundTripsThroughEncoding() started.
􀟈  Test historyResultToleratesSparseRows() started.
􀟈  Test case passing 1 argument slug → "edge-dev" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test whitelistOpDecodesDefensively() started.
􀟈  Test legacyOpenDecodesWithoutIncognito() started.
􀟈  Test case passing 1 argument slug → "edge-canary" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test lineBufferReassemblesSplitReads() started.
􀟈  Test envelopeDecodesAnyMessageForDispatch() started.
􀟈  Test case passing 1 argument slug → "vivaldi" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test openExternalDecodesDefensively() started.
􀟈  Test legacyPongDefaultsToUnknownBrowser() started.
􀟈  Test case passing 1 argument slug → "vivaldi-snapshot" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test encodedLineIsCompactAndNewlineTerminated() started.
􀟈  Test case passing 1 argument slug → "opera" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera-gx" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "opera-developer" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "helium" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test decodeLineToleratesTheTrailingNewline() started.
􀟈  Test case passing 1 argument slug → "arc" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "dia" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "comet" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test case passing 1 argument slug → "chromium" to needlePathResolvesToItsOwnSlug(slug:) started.
􀟈  Test incognitoOpenCarriesTheFlag() started.
􀟈  Test case passing 1 argument onDisk → "gray" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test urlInputLeadsWithAnOpenRow() started.
􀟈  Test case passing 1 argument onDisk → "grey" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "purple" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "#8e8e93" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test case passing 1 argument onDisk → "#3311aa" to selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) started.
􀟈  Test unmatchedQueryOffersOnlySearch() started.
􀟈  Test oneSiteCannotFloodTheList() started.
􁁛  Test validCustomDraftCommitsTheTemplate() passed after 0.003 seconds.
􀟈  Test autocompleteOffersOnlyAPrefixedHost() started.
􀟈  Test partialSiteNameRanksTheOriginFirst() started.
􀟈  Test searchRowFollowsTheTopHit() started.
􀟈  Test emptyQueryListsFrequentSitesWithoutASearchRow() started.
􁁛  Test settingsOffersTheSixProvidersInOrder() passed after 0.003 seconds.
􀟈  Test nearDuplicatePagesShowOnce() started.
􁁛  Test switchingPresetsDoesNotOverwriteACustomDraft() passed after 0.004 seconds.
􁁛  Test legacyConfigGetsAdditiveDefaults() passed after 0.007 seconds.
􁁛  Test invalidCustomDraftStaysVisibleAndDoesNotCommit() passed after 0.007 seconds.
􁁛  Test completeConfigDecodesVerbatim() passed after 0.008 seconds.
􀟈  Test searchTemplateSubstitutesTheEncodedQuery() started.
􀟈  Test displayHostDropsWWWAndFailsClosed() started.
􀟈  Test configuredSearchEngineIsUsed() started.
􀟈  Test normalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() started.
􀟈  Test templateWithoutPlaceholderFallsBackToDefault() started.
􀟈  Test searchTemplateTrimsTheQuery() started.
􀟈  Test textWithASchemeOrADotIsADestination() started.
􁁛  Test missingSearchEngineDefaultsToStartpage() passed after 0.008 seconds.
􁁛  Test storedProviderIsNotInferredFromTemplate() passed after 0.008 seconds.
􁁛  Test choicesAreNoneThenPresetsThenCustom() passed after 0.008 seconds.
􁁛  Test validTemplatesSubstituteTheEncodedQuery() passed after 0.008 seconds.
􁁛  Test encodingExistingConfigWritesInferredProvider() passed after 0.008 seconds.
􁁛  Test incompleteOrInvalidHexDoesNotNormalize(input:) with 9 test cases passed after 0.008 seconds.
􁁛  Test sleepNilOrEmptyCommitStoresGraphiteHex() passed after 0.008 seconds.
􁁛  Test emptyPartialAndInvalidDraftsKeepTheCommittedColor() passed after 0.008 seconds.
􁁛  Test presetCommitIsThatPresetsHex() passed after 0.008 seconds.
􁁛  Test completedHexNormalizes(input:expected:) with 4 test cases passed after 0.008 seconds.
􁁛  Test selectingGraphiteRewritesUnusableSleepTint(onDisk:) with 2 test cases passed after 0.008 seconds.
􁁛  Test existingNamedProviderStaysExplicit() passed after 0.008 seconds.
􁁛  Test typingAPresetHexWhileCustomKeepsTheEditorOpen() passed after 0.008 seconds.
􁁛  Test pickerHexSelectsCustomAndCommits() passed after 0.008 seconds.
􁁛  Test sleepNamedTokensDisplayAsChips() passed after 0.008 seconds.
􁁛  Test installScriptListsTheFullCatalog() passed after 0.008 seconds.
􁁛  Test unmatchedParentIsUnknown() passed after 0.008 seconds.
􁁛  Test needlePathResolvesToItsOwnSlug(slug:) with 22 test cases passed after 0.008 seconds.
􁁛  Test legacySleepNamedTokensStillDecode() passed after 0.008 seconds.
􁁛  Test hoverBarNilIsNoTint() passed after 0.008 seconds.
􁁛  Test emptySlugsAreDropped() passed after 0.008 seconds.
􁁛  Test lilNapChoicesOmitNoTintAndKeepPresetOrder() passed after 0.008 seconds.
􁁛  Test selectingCustomStaysCustomWithFieldVisible() passed after 0.008 seconds.
􁁛  Test seedTreatsPresetHexAsThatChipNotCustom() passed after 0.008 seconds.
􁁛  Test displayedSleepNamedTokenIsNotTheStoredToken() passed after 0.008 seconds.
􁁛  Test chromeBetaHelperPathIsNotChromeStable() passed after 0.008 seconds.
􁁛  Test catalogIsTheFullSupportedSet() passed after 0.008 seconds.
􁁛  Test siblingChannelsRemainSeparateInstallations() passed after 0.008 seconds.
􁁛  Test selectingDisplayedSleepChipDoesNotRewriteUsableTint(onDisk:) with 5 test cases passed after 0.008 seconds.
􀟈  Test everythingElseIsAQuery() started.
􁁛  Test selectingAPresetWritesItsNameAndTemplate(id:) with 5 test cases passed after 0.008 seconds.
􁁛  Test everyInstallationHasStableIdentity() passed after 0.008 seconds.
􁁛  Test reseedRestoresDraftFromCommitted() passed after 0.008 seconds.
􁁛  Test launchOrderIsPrimaryFallbackThenInstalled() passed after 0.008 seconds.
􁁛  Test unusableSleepTintIsNotCommittedGraphite() passed after 0.008 seconds.
􁁛  Test primaryLeadsEvenWithNoLiveSockets() passed after 0.008 seconds.
􁁛  Test hoverBarNoTintRoundTripsAsOmittedKey() passed after 0.009 seconds.
􁁛  Test duplicateTargetsCollapse() passed after 0.008 seconds.
􁁛  Test saveOverCorruptFileStillWrites() passed after 0.009 seconds.
􁁛  Test whitelistRemoveDropsTheDomain() passed after 0.009 seconds.
􁁛  Test configBundleIdBeatsTheBuiltInTable() passed after 0.008 seconds.
􁁛  Test hoverBarPresetAndCustomHexRoundTrip() passed after 0.008 seconds.
􁁛  Test unknownSlugContributesNothing() passed after 0.008 seconds.
􁁛  Test whitelistOpRejectsUnknownOpAndEmptyDomain() passed after 0.008 seconds.
􁁛  Test primaryThenFallbackThenOtherLiveHosts() passed after 0.008 seconds.
􁁛  Test tintWritePreservesUnknownFieldsAndStableEncoding() passed after 0.008 seconds.
􁁛  Test routingIdentitiesAreUnique() passed after 0.008 seconds.
􁁛  Test customFromNoTintKeepsNilAndStaysEditable() passed after 0.008 seconds.
􁁛  Test sleepPresetAndCustomHexRoundTrip() passed after 0.008 seconds.
􁁛  Test choosingNoTintCommitsNilWithoutRequiringADraft() passed after 0.008 seconds.
􁁛  Test encodingProviderPreservesUnknownTopLevelFields() passed after 0.009 seconds.
􁁛  Test normalizedDomainReducesInputToABareHost() passed after 0.008 seconds.
􁁛  Test whitelistAddPreservesEverythingElse() passed after 0.009 seconds.
􁁛  Test sleepNilCommitRoundTripsAsGraphiteHex() passed after 0.008 seconds.
􁁛  Test chromeStableHelperPathIsChrome() passed after 0.008 seconds.
􁁛  Test saveFromNoExistingFileWritesTheConfig() passed after 0.008 seconds.
􁁛  Test whitelistOpOnFreshFileSeedsDefaults() passed after 0.008 seconds.
􁁛  Test unchangedSaveKeepsUnknownFieldsVerbatim() passed after 0.008 seconds.
􁁛  Test profilesAreNotRoutingTargets() passed after 0.009 seconds.
􁁛  Test onlyAValidCompletedDraftCommits() passed after 0.008 seconds.
􁁛  Test absentHoverBarTintIsOmittedNotNull() passed after 0.008 seconds.
􁁛  Test unavailableInstallationsAreNotOfferedAsChoices() passed after 0.008 seconds.
􁁛  Test mergedReplacesKnownBrowsersWithTheFullScan() passed after 0.008 seconds.
􁁛  Test isInstalledReadsTheCatalogFlag() passed after 0.008 seconds.
􁁛  Test savePreservesUnknownTopLevelFields() passed after 0.008 seconds.
􁁛  Test normalOpenOmitsIncognitoOnTheWire() passed after 0.007 seconds.
􁁛  Test contextCarriesConfigObjectsAndHostIdentity() passed after 0.008 seconds.
􁁛  Test whitelistOpDecodesDefensively() passed after 0.007 seconds.
􁁛  Test contextRoundTripsThroughEncoding() passed after 0.007 seconds.
􁁛  Test historyResultToleratesSparseRows() passed after 0.007 seconds.
􁁛  Test envelopeDecodesAnyMessageForDispatch() passed after 0.007 seconds.
􁁛  Test lineBufferReassemblesSplitReads() passed after 0.007 seconds.
􁁛  Test scanKeepsUnavailableInstallations() passed after 0.008 seconds.
􁁛  Test openExternalDecodesDefensively() passed after 0.007 seconds.
􁁛  Test encodedLineIsCompactAndNewlineTerminated() passed after 0.007 seconds.
􁁛  Test decodeLineToleratesTheTrailingNewline() passed after 0.006 seconds.
􁁛  Test legacyPongDefaultsToUnknownBrowser() passed after 0.007 seconds.
􁁛  Test incognitoOpenCarriesTheFlag() passed after 0.006 seconds.
􁁛  Test oneSiteCannotFloodTheList() passed after 0.006 seconds.
􁁛  Test legacyOpenDecodesWithoutIncognito() passed after 0.007 seconds.
􁁛  Test partialSiteNameRanksTheOriginFirst() passed after 0.006 seconds.
􁁛  Test detectionNeedlesDoNotCrossMatch() passed after 0.009 seconds.
􁁛  Test urlInputLeadsWithAnOpenRow() passed after 0.006 seconds.
􁁛  Test emptyQueryListsFrequentSitesWithoutASearchRow() passed after 0.006 seconds.
􁁛  Test unmatchedQueryOffersOnlySearch() passed after 0.006 seconds.
􁁛  Test displayHostDropsWWWAndFailsClosed() passed after 0.001 seconds.
􁁛  Test searchTemplateSubstitutesTheEncodedQuery() passed after 0.001 seconds.
􁁛  Test whitelistAddIsIdempotent() passed after 0.009 seconds.
􁁛  Suite ConfigDecodingTests passed after 0.010 seconds.
􁁛  Test normalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() passed after 0.001 seconds.
􁁛  Test searchRowFollowsTheTopHit() passed after 0.006 seconds.
􁁛  Test templateWithoutPlaceholderFallsBackToDefault() passed after 0.001 seconds.
􁁛  Test configuredSearchEngineIsUsed() passed after 0.001 seconds.
􁁛  Test nearDuplicatePagesShowOnce() passed after 0.005 seconds.
􁁛  Test searchTemplateTrimsTheQuery() passed after 0.001 seconds.
􁁛  Test textWithASchemeOrADotIsADestination() passed after 0.001 seconds.
􁁛  Test writtenBytesAreSortedAndStable() passed after 0.009 seconds.
􁁛  Test autocompleteOffersOnlyAPrefixedHost() passed after 0.006 seconds.
􁁛  Suite RoutingOrderTests passed after 0.010 seconds.
􁁛  Test everythingElseIsAQuery() passed after 0.001 seconds.
􁁛  Suite BrowserCatalogTests passed after 0.010 seconds.
􁁛  Suite SearchProviderTests passed after 0.010 seconds.
􁁛  Suite PaletteRowsTests passed after 0.010 seconds.
􁁛  Suite URLIntentTests passed after 0.010 seconds.
􁁛  Suite TintTests passed after 0.010 seconds.
􁁛  Suite MessageTests passed after 0.010 seconds.
􁁛  Suite ConfigMergeTests passed after 0.010 seconds.
􁁛  Test protocolDocumentsEveryCatalogEntry() passed after 0.011 seconds.
􁁛  Suite BrowserTableTests passed after 0.012 seconds.
􁁛  Test profileDirectoriesAreNeverInstallTargets() passed after 0.016 seconds.
􁁛  Test missingInstallationsAreSkipped() passed after 0.023 seconds.
􁁛  Test writingManifestsCoversEveryExistingCatalogDir() passed after 0.105 seconds.
􁁛  Suite NativeHostManifestTests passed after 0.105 seconds.
􁁛  Test run with 107 tests in 11 suites passed after 0.106 seconds.
```
