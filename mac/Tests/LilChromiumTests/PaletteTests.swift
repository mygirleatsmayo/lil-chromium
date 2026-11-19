import AppKit
import Testing
@testable import LilChromiumApp
@testable import LilShared

/// What the palette shows for a query. The model is fed a history snapshot and a
/// search engine directly, so no live browser, socket, or config file is
/// involved and ranking is deterministic (history times are compared against a
/// fixed "now").
struct PaletteRowsTests {

    /// A fixed clock 1 day after the newest fixture visit, so recency decay is
    /// the same on every run.
    private let nowMs: Double = 1_700_085_400_000

    private func makeModel() throws -> PaletteModel {
        let history = try Fixture.decode(HistoryResultMessage.self, from: "message-history-result")
        let model = PaletteModel()
        model.setIndex(Ranking.buildIndex(items: history.items, nowMs: nowMs))
        model.searchEngine = try Fixture.decode(LilConfig.self, from: "config-v2-complete").searchEngine
        return model
    }

    /// Typed text that names a site puts that site's origin first — not a deep
    /// page that happens to mention it.
    @Test func partialSiteNameRanksTheOriginFirst() throws {
        let rows = try makeModel().rows(for: "gi")

        #expect(rows.first?.kind == .history)
        #expect(rows.first?.actionURL == "https://github.com")
        #expect(rows.first?.subtitle == "github.com")
    }

    /// The search row always sits at position 2 for a non-URL query, built from
    /// the configured search engine.
    @Test func searchRowFollowsTheTopHit() throws {
        let rows = try makeModel().rows(for: "gi")

        #expect(rows[1].kind == .search)
        #expect(rows[1].title == "Search Kagi for “gi”")
        #expect(rows[1].actionURL == "https://kagi.com/search?q=gi")
        #expect(rows[1].subtitle == "kagi.com")
    }

    /// A query nothing matches still offers a search — the palette never dead-ends.
    @Test func unmatchedQueryOffersOnlySearch() throws {
        let rows = try makeModel().rows(for: "quarterly budget review")

        #expect(rows.count == 1)
        #expect(rows[0].kind == .search)
        #expect(rows[0].actionURL == "https://kagi.com/search?q=quarterly%20budget%20review")
    }

    /// URL-ish input replaces the top hit with an explicit "Open …" row, with the
    /// scheme filled in.
    @Test func urlInputLeadsWithAnOpenRow() throws {
        let rows = try makeModel().rows(for: "docs.swift.org/guide")

        #expect(rows[0].kind == .openURL)
        #expect(rows[0].title == "Open docs.swift.org/guide")
        #expect(rows[0].actionURL == "https://docs.swift.org/guide")
        #expect(rows[1].kind == .search, "search stays available for URL-ish input")
    }

    /// One chatty site cannot flood the list, and `www.` is not a separate site.
    @Test func oneSiteCannotFloodTheList() throws {
        let rows = try makeModel().rows(for: "example")

        #expect(rows.filter { $0.host == "example.com" }.count == 3, "at most 3 rows per host")
        #expect(Set(rows.map(\.actionURL)).count == rows.count, "no row repeats a URL")
        #expect(rows.first?.actionURL == "https://example.com")
    }

    /// The same page revisited with drifting query strings is one destination,
    /// not three near-identical rows.
    @Test func nearDuplicatePagesShowOnce() throws {
        let rows = try makeModel().rows(for: "posts")

        let pages = rows.filter { $0.kind == .history }
        #expect(pages.count == 1, "?q=sys / ?q=syst / ?q=syste are one page")
        let page = try #require(pages.first)
        #expect(page.actionURL.contains("example.com/posts"))
    }

    /// An empty palette lists frequent sites and offers no search row.
    @Test func emptyQueryListsFrequentSitesWithoutASearchRow() throws {
        let rows = try makeModel().rows(for: "")

        #expect(rows.isEmpty == false)
        #expect(rows.allSatisfy { $0.kind == .history })
        #expect(rows.first?.actionURL == "https://github.com", "most frecent site leads")
        #expect(rows.count <= 8)
    }

    /// Inline autocomplete only offers a host that actually prefixes the query.
    @Test func autocompleteOffersOnlyAPrefixedHost() throws {
        let model = try makeModel()

        #expect(model.autocompleteHost(for: "git") == "github.com")
        #expect(model.autocompleteHost(for: "quarterly budget review") == nil)
    }
}

/// Gear-adjacent discoverability (issue #9): typing “settings” or
/// “preferences” offers a selectable Settings result that is not a lil open.
struct PaletteSettingsAccessTests {

    private func model() -> PaletteModel {
        PaletteModel()
    }

    @Test(arguments: ["settings", "Settings", "SETTINGS"])
    func settingsQueryLeadsWithTheSettingsAction(_ query: String) {
        let rows = model().rows(for: query)
        let row = rows.first

        #expect(row?.kind == .settings)
        #expect(row?.title == "Settings")
        #expect(row?.actionURL == SettingsAction.urlString)
        #expect(rows.contains { $0.kind == .search }, "Search stays available below Settings")
    }

    @Test(arguments: ["preferences", "Preferences", "PREFERENCES"])
    func preferencesQueryLeadsWithTheSettingsAction(_ query: String) {
        let rows = model().rows(for: query)

        #expect(rows.first?.kind == .settings)
        #expect(rows.first?.actionURL == SettingsAction.urlString)
        #expect(rows.contains { $0.kind == .search }, "Search stays available below Settings")
    }

    @Test(
        "Partial stubs stay ordinary non-URL queries",
        .bug(id: 9),
        arguments: ["set", "sett", "pref", "prefer"]
    )
    func partialSettingsStubsStayOrdinaryNonURLQueries(_ query: String) {
        let rows = model().rows(for: query)

        #expect(rows.contains { $0.kind == .settings } == false)
        #expect(rows.first?.kind == .search)
    }

    @Test(arguments: ["", "s", "p", "gi", "quarterly budget review", "settings extra"])
    func unrelatedQueriesDoNotOfferSettings(_ query: String) {
        let rows = model().rows(for: query)

        #expect(rows.contains { $0.kind == .settings } == false)
    }
}

/// Row ORDER around the Search action (issue #13).
///
/// The rule under test: for non-empty, non-URL text, only a contiguous literal
/// match inside the distinctive label of a history entry's registrable domain
/// may sit above Search. Public suffixes (e.g. `com`) never promote.
/// Every assertion names rows and action URLs in order — never a score.
struct PaletteOrderingTests {

    /// A fixed clock; every fixture visit is expressed as an age against it.
    private let nowMs: Double = 1_700_000_000_000

    /// One history entry. Defaults describe an ordinary, recently visited page.
    private func visit(
        _ url: String,
        title: String = "",
        visits: Int = 5,
        typed: Int = 0,
        daysAgo: Double = 1
    ) -> HistoryItem {
        HistoryItem(
            url: url,
            title: title,
            lastVisitTime: nowMs - daysAgo * 86_400_000,
            visitCount: visits,
            typedCount: typed
        )
    }

    /// A palette model over exactly `items`, searching with the Startpage default.
    private func model(_ items: HistoryItem...) -> PaletteModel {
        model(items)
    }

    private func model(_ items: [HistoryItem]) -> PaletteModel {
        let model = PaletteModel()
        model.setIndex(Ranking.buildIndex(items: items, nowMs: nowMs))
        model.searchEngine = .defaults
        return model
    }

    // MARK: - Above Search: literal registrable-domain matches

    /// "git" prefixes the registrable domain github.com, so the site leads.
    @Test func registrableDomainPrefixLeadsSearch() {
        let rows = model(visit("https://github.com/", title: "GitHub")).rows(for: "git")

        #expect(rows.map(\.kind) == [.history, .search])
        #expect(rows[0].actionURL == "https://github.com")
    }

    /// "hub" sits inside github.com — an interior match is as eligible as a prefix.
    @Test func registrableDomainInteriorMatchLeadsSearch() {
        let rows = model(visit("https://github.com/", title: "GitHub")).rows(for: "hub")

        #expect(rows.map(\.kind) == [.history, .search])
        #expect(rows[0].actionURL == "https://github.com")
    }

    // MARK: - Below Search: everything else

    /// "news" matches only the subdomain of news.ycombinator.com, so Search leads.
    @Test func subdomainOnlyMatchStaysBelowSearch() {
        let rows = model(
            visit("https://news.ycombinator.com/", title: "Hacker News")
        ).rows(for: "news")

        #expect(rows.map(\.kind) == [.search, .history])
        #expect(rows[1].actionURL == "https://news.ycombinator.com")
    }

    /// A title word is not a domain, so "gizmo" searches first.
    @Test func titleOnlyMatchStaysBelowSearch() {
        let rows = model(
            visit("https://github.com/", title: "GitHub", visits: 50),
            visit("https://github.com/acme/app/commit/1", title: "Fix gizmo alignment")
        ).rows(for: "gizmo")

        #expect(rows.map(\.kind) == [.search, .history])
        #expect(rows[1].actionURL == "https://github.com/acme/app/commit/1")
    }

    /// A path segment is not a domain either.
    @Test func pathOnlyMatchStaysBelowSearch() {
        let rows = model(
            visit("https://example.com/", title: "Example", visits: 50),
            visit("https://example.com/pricing", title: "Plans")
        ).rows(for: "pricing")

        #expect(rows.map(\.kind) == [.search, .history])
        #expect(rows[1].actionURL == "https://example.com/pricing")
    }

    /// Nor is a query string.
    @Test func queryStringOnlyMatchStaysBelowSearch() {
        let rows = model(visit("https://example.com/s?q=telescope", title: "Results")).rows(for: "telescope")

        #expect(rows.map(\.kind) == [.search, .history])
        #expect(rows[1].actionURL == "https://example.com/s?q=telescope")
    }

    /// Text that appears only in an unrelated part of the URL stays below Search.
    @Test func unrelatedURLTextStaysBelowSearch() {
        let rows = model(visit("https://example.com/blog/https-primer", title: "HTTPS")).rows(for: "https-primer")

        #expect(rows.map(\.kind) == [.search, .history])
    }

    /// Novel text nothing matches leaves Search alone at the top.
    @Test func unmatchedTextLeadsWithSearch() {
        let rows = model(visit("https://github.com/", title: "GitHub")).rows(for: "quarterly review")

        #expect(rows.map(\.kind) == [.search])
    }

    // MARK: - Fuzzy matches

    /// Approximate matches stay available, but a subsequence scattered across a
    /// title cannot outrank a dense one — the gap penalty is what separates them.
    /// Both sit below Search because neither touches a registrable domain.
    @Test func denseFuzzyMatchOutranksAScatteredOne() {
        let rows = model(
            visit("https://example.com/", title: "Example", visits: 50),
            visit("https://example.com/2", title: "Sunny Weather Update Info"),
            visit("https://example.com/1", title: "SwiftUI Basics")
        ).rows(for: "swui")

        #expect(rows.map(\.kind) == [.search, .history, .history])
        #expect(rows[1].actionURL == "https://example.com/1", "dense subsequence ranks higher")
        #expect(rows[2].actionURL == "https://example.com/2", "every match lands on a word boundary, but the gaps are large")
    }

    // MARK: - Competing eligible domains

    /// Two domains both contain "exa"; the more frecent one takes the row above
    /// Search and the other falls in below it.
    @Test func frecencyBreaksTiesBetweenEligibleDomains() {
        let rows = model(
            visit("https://examples.org/", title: "Examples", visits: 2, typed: 0),
            visit("https://example.com/", title: "Example", visits: 90, typed: 30)
        ).rows(for: "exa")

        #expect(rows.map(\.kind) == [.history, .search, .history])
        #expect(rows[0].actionURL == "https://example.com")
        #expect(rows[2].actionURL == "https://examples.org")
    }

    /// SP1: both domains are eligible, but one is a prefix match (higher tier)
    /// and the other is a more-frecent interior match. Frecency, not tier,
    /// chooses the row above Search.
    @Test func frecencyNotTierChoosesAmongEligibleDomains() {
        let rows = model(
            visit("https://hubspot.com/", title: "HubSpot", visits: 20),
            visit("https://github.com/", title: "GitHub", visits: 90, typed: 30)
        ).rows(for: "hub")

        #expect(rows.map(\.kind) == [.history, .search, .history])
        #expect(rows[0].actionURL == "https://github.com")
        #expect(rows[2].actionURL == "https://hubspot.com")
    }

    /// NA1: the promoted row (github.com, more frecent) and the inline
    /// type-ahead host must be the same site. HubSpot is the higher-tier
    /// prefix; it stays below Search and must not become the ghost text.
    @Test func promotedRowAndTypeAheadNameTheSameHost() {
        let palette = model(
            visit("https://hubspot.com/", title: "HubSpot", visits: 20),
            visit("https://github.com/", title: "GitHub", visits: 90, typed: 30)
        )
        let rows = palette.rows(for: "hub")

        #expect(rows.map(\.kind) == [.history, .search, .history])
        #expect(rows[0].actionURL == "https://github.com")
        #expect(rows[2].actionURL == "https://hubspot.com")
        #expect(rows[0].host == "github.com")
        #expect(palette.autocompleteHost(for: "hub") == rows[0].host)
    }

    /// SP2: seven ineligible host-prefix rows would fill the old rank budget
    /// and drop the eligible interior match, so Search would lead. Eligibility
    /// is resolved first; github.com stays above Search.
    @Test func eligibleMatchIsNotEvictedByIneligiblePrefixRows() {
        let ineligible = ["alpha", "beta", "gamma", "delta", "echo", "foxtrot", "golf"].map {
            visit("https://hub.\($0).com/", title: $0, visits: 90, typed: 30)
        }
        let rows = model(
            ineligible + [visit("https://github.com/", title: "GitHub", visits: 5)]
        ).rows(for: "hub")

        #expect(rows[0].kind == .history)
        #expect(rows[0].actionURL == "https://github.com")
        #expect(rows[1].kind == .search)
    }

    // MARK: - Distinctive label only (no TLD matching)

    /// D1: `com` is the public suffix, not the distinctive label, so it cannot
    /// promote every `.com` site above Search.
    @Test func bareTLDQueryFallsToSearch() {
        let rows = model(
            visit("https://github.com/", title: "GitHub", visits: 90, typed: 30),
            visit("https://example.com/", title: "Example", visits: 50)
        ).rows(for: "com")

        #expect(rows[0].kind == .search)
        #expect(rows.contains { $0.actionURL == "https://github.com" })
        #expect(rows.contains { $0.actionURL == "https://example.com" })
    }

    /// D1: the distinctive label still promotes, including under a country-code
    /// public suffix.
    @Test func registrableLabelMatchStillPromotes() {
        let rows = model(
            visit("https://shop.example.co.uk/", title: "Shop")
        ).rows(for: "example")

        #expect(rows.map(\.kind) == [.history, .search])
        #expect(rows[0].actionURL == "https://shop.example.co.uk")
    }

    // MARK: - Duplicates and per-host limits

    /// Pages that tie on every ranking signal still produce ONE fixed order:
    /// `www.` is not a second site, and the per-host cap keeps the same three
    /// rows whichever order the browser reported history in.
    @Test func duplicatesAndPerHostCapDoNotDependOnHistoryOrder() {
        let history = [
            visit("https://example.com/a", title: "Alpha"),
            visit("https://www.example.com/a", title: "Alpha"),
            visit("https://example.com/b", title: "Bravo"),
            visit("https://example.com/c", title: "Charlie"),
            visit("https://example.com/d", title: "Delta"),
        ]

        let forward = model(history).rows(for: "example").map(\.actionURL)
        let reversed = model(history.reversed()).rows(for: "example").map(\.actionURL)

        #expect(forward == reversed, "row order is a function of history content, not its arrival order")
        #expect(forward == [
            "https://example.com",
            "https://www.startpage.com/sp/search?query=example",
            "https://example.com/a",
            "https://example.com/b",
        ])
    }

    // MARK: - URL-like input

    /// URL-ish text keeps Open first and Search immediately after it, even when
    /// history holds a literal domain match for the same site.
    @Test func urlInputKeepsOpenThenSearchAhead() {
        let rows = model(visit("https://example.com/", title: "Example", visits: 90, typed: 30))
            .rows(for: "example.com/pricing")

        #expect(rows.prefix(2).map(\.kind) == [.openURL, .search])
        #expect(rows[0].actionURL == "https://example.com/pricing")
    }
}

/// Return chooses a concrete palette action at the native model boundary.
/// The controller strips lock/key-origin metadata before this seam, leaving
/// only Command, Shift, Option, and Control in the finite chord domain.
struct PaletteActionTests {

    struct TranslationCase: Sendable {
        let flags: NSEvent.ModifierFlags
        let chord: PaletteReturnChord
    }

    @Test("Return chord opens the selected action", .bug(id: 14))
    func returnChordOpensTheSelectedAction() throws {
        let model = PaletteModel()
        let input = "example.com/pricing"
        let selectedRow = try #require(model.rows(for: input).first)

        let action = try #require(model.action(
            for: input,
            selectedRow: selectedRow,
            chord: .plain
        ))

        #expect(action.kind == .open)
        #expect(action.url == "https://example.com/pricing")
        #expect(action.incognito == false)
        #expect(action.hint == "⏎ Open")
    }

    @Test("Shift-Return forces search", .bug(id: 14))
    func shiftReturnForcesSearch() throws {
        let model = PaletteModel()
        model.searchEngine = SearchEngineConfig(
            name: "Kagi",
            template: "https://kagi.com/search?q=%s",
            provider: "kagi"
        )
        let selectedRow = try #require(model.rows(for: "example.com/pricing").first)

        let action = try #require(model.action(
            for: "privacy news",
            selectedRow: selectedRow,
            chord: [.shift]
        ))

        #expect(action.kind == .search)
        #expect(action.url == "https://kagi.com/search?q=privacy%20news")
        #expect(action.incognito == false)
        #expect(action.hint == "⇧⏎ Search")
    }

    @Test("Command-Return opens incognito", .bug(id: 14))
    func commandReturnOpensIncognito() throws {
        let model = PaletteModel()
        let input = "example.com/private"
        let selectedRow = try #require(model.rows(for: input).first)

        let action = try #require(model.action(
            for: input,
            selectedRow: selectedRow,
            chord: [.command]
        ))

        #expect(action.kind == .open)
        #expect(action.url == "https://example.com/private")
        #expect(action.incognito == true)
        #expect(action.hint == "⌘⏎ Open Incognito")
    }

    @Test("Command-Shift-Return forces incognito search", .bug(id: 14))
    func commandShiftReturnForcesIncognitoSearch() throws {
        let model = PaletteModel()
        model.searchEngine = SearchEngineConfig(
            name: "Kagi",
            template: "https://kagi.com/search?q=%s",
            provider: "kagi"
        )
        let selectedRow = try #require(model.rows(for: "example.com/private").first)

        let action = try #require(model.action(
            for: "secret cats",
            selectedRow: selectedRow,
            chord: [.command, .shift]
        ))

        #expect(action.kind == .search)
        #expect(action.url == "https://kagi.com/search?q=secret%20cats")
        #expect(action.incognito == true)
        #expect(action.hint == "⇧⌘⏎ Search Incognito")
    }

    @Test("Return uses the current selection", .bug(id: 14))
    func returnUsesTheCurrentSelection() throws {
        let model = PaletteModel()
        let input = "example.com/pricing"
        let rows = model.rows(for: input)
        let selectedSearchRow = try #require(rows.dropFirst().first)

        let action = try #require(model.action(
            for: input,
            selectedRow: selectedSearchRow,
            chord: .plain
        ))

        #expect(action.kind == .search)
        #expect(action.url == "https://www.startpage.com/sp/search?query=example.com/pricing")
        #expect(action.incognito == false)
        #expect(action.hint == "⏎ Search")
    }

    @Test(
        "Extra modifiers never submit an action",
        .bug(id: 14),
        arguments: [
            PaletteReturnChord.option,
            PaletteReturnChord.control,
            PaletteReturnChord([.shift, .option]),
            PaletteReturnChord([.command, .option]),
            PaletteReturnChord([.command, .shift, .control]),
        ]
    )
    func extraModifiersNeverSubmitAnAction(_ chord: PaletteReturnChord) throws {
        let model = PaletteModel()
        let selectedRow = try #require(model.rows(for: "example.com/private").first)

        let action = model.action(
            for: "private search",
            selectedRow: selectedRow,
            chord: chord
        )

        #expect(action == nil)
    }

    @Test("Return on Settings requests native Settings", .bug(id: 9))
    func returnOnSettingsRequestsNativeSettings() throws {
        let model = PaletteModel()
        let selectedRow = try #require(model.rows(for: "settings").first)

        let action = try #require(model.action(
            for: "settings",
            selectedRow: selectedRow,
            chord: .plain
        ))

        #expect(selectedRow.kind == .settings)
        #expect(action.kind == .settings)
        #expect(action.url == SettingsAction.urlString)
        #expect(action.incognito == false)
        #expect(action.hint == "⏎ Settings")
    }

    @Test("Command-Return on Settings is still Settings, not an incognito lil", .bug(id: 9))
    func commandReturnOnSettingsDoesNotOpenALil() throws {
        let model = PaletteModel()
        let selectedRow = try #require(model.rows(for: "preferences").first)

        let action = try #require(model.action(
            for: "preferences",
            selectedRow: selectedRow,
            chord: [.command]
        ))

        #expect(action.kind == .settings)
        #expect(action.incognito == false)
    }

    @Test("Shift-Return still searches when Settings is selected", .bug(id: 14))
    func shiftReturnSearchesEvenWhenSettingsIsSelected() throws {
        let model = PaletteModel()
        let selectedRow = try #require(model.rows(for: "settings").first)

        let action = try #require(model.action(
            for: "settings",
            selectedRow: selectedRow,
            chord: [.shift]
        ))

        #expect(action.kind == .search)
        #expect(action.url == SearchEngineConfig.defaults.searchURL(for: "settings"))
    }

    @MainActor
    @Test(
        "Event metadata does not change a Return chord",
        .bug(id: 14),
        arguments: [
            TranslationCase(flags: [], chord: .plain),
            TranslationCase(flags: [.shift], chord: .shift),
            TranslationCase(flags: [.command], chord: .command),
            TranslationCase(flags: [.command, .shift], chord: [.command, .shift]),
        ],
        [
            NSEvent.ModifierFlags.capsLock,
            .numericPad,
            .function,
            .help,
            [.capsLock, .numericPad, .function, .help],
        ]
    )
    func eventMetadataDoesNotChangeReturnChord(
        _ translation: TranslationCase,
        _ metadata: NSEvent.ModifierFlags
    ) {
        #expect(
            PaletteController.returnChord(from: translation.flags.union(metadata))
                == translation.chord
        )
    }

    @MainActor
    @Test(
        "Option and Control stay semantic and unsupported with event metadata",
        .bug(id: 14),
        arguments: [
            TranslationCase(flags: [.option], chord: .option),
            TranslationCase(flags: [.control], chord: .control),
            TranslationCase(flags: [.command, .option], chord: [.command, .option]),
            TranslationCase(flags: [.shift, .control], chord: [.shift, .control]),
            TranslationCase(flags: [.command, .shift, .option], chord: [.command, .shift, .option]),
            TranslationCase(flags: [.command, .shift, .control], chord: [.command, .shift, .control]),
        ]
    )
    func optionAndControlStayUnsupportedWithEventMetadata(
        _ translation: TranslationCase
    ) throws {
        let metadata: NSEvent.ModifierFlags = [.capsLock, .numericPad, .function, .help]
        let chord = PaletteController.returnChord(from: translation.flags.union(metadata))
        let model = PaletteModel()
        let selectedRow = try #require(model.rows(for: "example.com/private").first)

        #expect(chord == translation.chord)
        #expect(model.action(for: "private search", selectedRow: selectedRow, chord: chord) == nil)
    }
}

/// Inline completion is the default action (issue #38): the field text, the
/// top row, and plain Return always name the same destination.
///
/// The palette is driven the way its field editor drives it: each typed
/// character replaces the selected completion remainder, or lands at the caret.
struct PaletteCompletionTests {

    private let nowMs: Double = 1_700_000_000_000

    /// GitHub (the only `git…` host) plus an unrelated site, Startpage search.
    private func palette() -> PaletteModel {
        let visit = { (url: String, title: String) in
            HistoryItem(url: url, title: title, lastVisitTime: nowMs - 86_400_000,
                        visitCount: 40, typedCount: 10)
        }
        let model = PaletteModel()
        model.setIndex(Ranking.buildIndex(items: [
            visit("https://github.com/", "GitHub"),
            visit("https://example.com/", "Example"),
        ], nowMs: nowMs))
        model.searchEngine = .defaults
        return model
    }

    private func type(
        _ characters: String,
        into palette: PaletteModel,
        after input: PaletteInput = PaletteInput()
    ) -> PaletteInput {
        characters.reduce(input) { palette.editing($0, to: $0.typed + String($1)) }
    }

    /// What Return does with the top row selected.
    private func returnAction(
        _ palette: PaletteModel,
        _ input: PaletteInput,
        _ chord: PaletteReturnChord = .plain
    ) -> PaletteAction? {
        palette.action(for: input, selectedRow: palette.rows(for: input).first, chord: chord)
    }

    @Test func typedPrefixCompletesToTheHostAndReturnOpensIt() throws {
        let palette = palette()
        let input = type("g", into: palette)

        #expect(input.text == "github.com")
        #expect(input.completionRange == NSRange(location: 1, length: 9))
        let top = try #require(palette.rows(for: input).first)
        #expect(top.kind == .history)
        #expect(top.actionURL == "https://github.com")
        let action = try #require(returnAction(palette, input))
        #expect(action.kind == .open)
        #expect(action.url == "https://github.com")
        #expect(action.hint == "⏎ Open")
    }

    /// Dotted and URL-like typed text still opens the completed host, not a
    /// search and not the half-typed URL.
    @Test(.bug(id: 38), arguments: ["github.", "github.c", "github.co"])
    func dottedTextOpensTheCompletedHost(_ typed: String) throws {
        let palette = palette()
        let input = type(typed, into: palette)

        #expect(input.text == "github.com")
        let rows = palette.rows(for: input)
        #expect(rows.first?.actionURL == "https://github.com")
        let action = try #require(returnAction(palette, input))
        #expect(action.kind == .open)
        #expect(action.url == "https://github.com")
        #expect(action.hint == "⏎ Open")
    }

    /// Below the completion sit the typed text's own rows, in today's order,
    /// with GitHub not repeated.
    @Test(.bug(id: 38)) func rowsBelowTheCompletionAreTheTypedTextsRows() {
        let palette = palette()

        let urlLike = palette.rows(for: type("github.c", into: palette))
        #expect(urlLike.map(\.actionURL) == [
            "https://github.com",
            "https://github.c",
            "https://www.startpage.com/sp/search?query=github.c",
        ])
        #expect(urlLike.map(\.kind) == [.history, .openURL, .search])

        let plain = palette.rows(for: type("git", into: palette))
        #expect(plain.map(\.actionURL) == [
            "https://github.com",
            "https://www.startpage.com/sp/search?query=git",
        ])
    }

    @Test(.bug(id: 38)) func commandReturnOpensTheCompletedHostIncognito() throws {
        let palette = palette()
        let action = try #require(returnAction(palette, type("github.c", into: palette), [.command]))

        #expect(action.kind == .open)
        #expect(action.url == "https://github.com")
        #expect(action.incognito)
        #expect(action.hint == "⌘⏎ Open Incognito")
    }

    /// Forced search uses what the user typed, never the completed host.
    @Test(.bug(id: 38), arguments: [PaletteReturnChord.shift, [.command, .shift]])
    func shiftReturnSearchesTheTypedText(_ chord: PaletteReturnChord) throws {
        let palette = palette()
        let action = try #require(returnAction(palette, type("github.", into: palette), chord))

        #expect(action.kind == .search)
        #expect(action.url == "https://www.startpage.com/sp/search?query=github.")
        #expect(action.incognito == chord.contains(.command))
    }

    /// →, ⌘→, End, or a click drop the selection without editing: the whole
    /// field text becomes the query, as if the user had typed it.
    @Test(.bug(id: 38), arguments: [
        NSRange(location: 10, length: 0),  // →, ⌘→, End: caret after the text
        NSRange(location: 3, length: 0),   // a click inside the text
    ])
    func acceptingTheCompletionMakesTheFieldTextTheQuery(_ selection: NSRange) throws {
        let palette = palette()
        var input = type("git", into: palette)

        let accepted = input.selectionDidChange(to: selection, in: "github.com")
        #expect(accepted)
        #expect(input.text == "github.com")
        #expect(input.completionRange == nil)
        let rows = palette.rows(for: input)
        #expect(rows.map(\.kind) == palette.rows(for: "github.com").map(\.kind))
        #expect(rows.first?.kind == .openURL)
        let action = try #require(returnAction(palette, input))
        #expect(action.url == "https://github.com")
        #expect(action.hint == "⏎ Open")
    }

    /// Re-selecting the remainder, or a selection change while the text is
    /// mid-edit (the field editor posts it before the text-change callback),
    /// is not an acceptance.
    @Test(.bug(id: 38)) func selectionThatStillShowsTheCompletionChangesNothing() {
        let palette = palette()
        var input = type("git", into: palette)

        let reselected = input.selectionDidChange(to: NSRange(location: 3, length: 7), in: "github.com")
        let midEdit = input.selectionDidChange(to: NSRange(location: 4, length: 0), in: "gitx")
        #expect(!reselected)
        #expect(!midEdit)
        #expect(input.text == "github.com")
        #expect(input.completionRange == NSRange(location: 3, length: 7))
    }

    /// Backspace or Delete on the selected remainder leaves the typed text as
    /// the query, and type-ahead stays off until the next inserted character.
    @Test(.bug(id: 38)) func deletingTheRemainderLeavesTheTypedText() throws {
        let palette = palette()
        let deleted = palette.editing(type("github.", into: palette), to: "github.")

        #expect(deleted.text == "github.")
        #expect(deleted.completionRange == nil)
        #expect(palette.rows(for: deleted).first?.kind == .search)
        #expect(returnAction(palette, deleted)?.url == "https://www.startpage.com/sp/search?query=github.")

        let retyped = type("c", into: palette, after: deleted)
        #expect(retyped.text == "github.com")
        #expect(returnAction(palette, retyped)?.url == "https://github.com")
    }

    /// With no completion on screen, rows and Return are exactly today's.
    @Test(.bug(id: 38), arguments: ["quarterly review", "example.com/pricing", "news"])
    func withoutACompletionNothingChanges(_ typed: String) {
        let palette = palette()
        let input = type(typed, into: palette)

        #expect(input.completionRange == nil)
        #expect(palette.rows(for: input).map(\.actionURL) == palette.rows(for: typed).map(\.actionURL))
        let today = palette.action(for: typed, selectedRow: palette.rows(for: typed).first, chord: .plain)
        #expect(returnAction(palette, input) == today)
    }
}
