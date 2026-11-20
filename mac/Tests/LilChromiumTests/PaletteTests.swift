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
        model.install(Ranking.buildIndex(items: history.items, nowMs: nowMs), from: model.beginRefresh())
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

    /// Word order never hides a page (issue #42): every term of a multi-word
    /// query must appear in the host, title, or URL — in any order, in any field.
    @Test(
        "Multi-word queries find a page in any word order",
        .bug(id: 42),
        arguments: ["fix gizmo", "gizmo fix", "alignment gizmo", "github gizmo"]
    )
    func multiWordQueriesMatchInAnyOrder(_ query: String) throws {
        let rows = try makeModel().rows(for: query)

        #expect(rows.first?.kind == .search, "a multi-word query never leads Search")
        #expect(rows.dropFirst().first?.actionURL
            == "https://github.com/mygirleatsmayo/lil-chromium/commit/deadbeef")
    }

    /// Inline autocomplete only offers a host that actually prefixes the query.
    @Test func autocompleteOffersOnlyAPrefixedHost() throws {
        let model = try makeModel()

        #expect(model.results(for: "git").autocompleteHost == "github.com")
        #expect(model.results(for: "quarterly budget review").autocompleteHost == nil)
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

/// Shared history fixtures for palette suites that build their own history.
/// A suite adds standing pages through `baseHistory`.
protocol PaletteHistoryFixture {
    /// Pages present in every palette the suite builds.
    var baseHistory: [HistoryItem] { get }
}

extension PaletteHistoryFixture {
    var baseHistory: [HistoryItem] { [] }

    /// A fixed clock; every fixture visit is expressed as an age against it.
    var nowMs: Double { 1_700_000_000_000 }

    /// One history entry. Defaults describe an ordinary, recently visited page.
    func visit(
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

    /// A palette model over `items` plus `baseHistory`, searching with the
    /// Startpage default.
    func model(_ items: HistoryItem...) -> PaletteModel {
        model(items)
    }

    func model(_ items: [HistoryItem]) -> PaletteModel {
        let model = PaletteModel()
        model.install(Ranking.buildIndex(items: items + baseHistory, nowMs: nowMs), from: model.beginRefresh())
        model.searchEngine = .defaults
        return model
    }
}

/// Row ORDER around the Search action (issue #13).
///
/// The rule under test: for non-empty, non-URL text, only a contiguous literal
/// match inside the distinctive label of a history entry's registrable domain
/// may sit above Search. Public suffixes (e.g. `com`) never promote.
/// Every assertion names rows and action URLs in order — never a score.
struct PaletteOrderingTests: PaletteHistoryFixture {

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
        #expect(palette.results(for: "hub").autocompleteHost == rows[0].host)
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

/// The any-order matching contract for multi-word queries (issue #42). Every
/// assertion names rows in order — never a score.
struct PaletteAnyOrderTests: PaletteHistoryFixture {

    /// example.com's root page, so the site's origin row is titled "Example"
    /// and never matches the queries under test.
    var baseHistory: [HistoryItem] {
        [visit("https://example.com/", title: "Example", visits: 50)]
    }

    private func historyURLs(_ rows: [PaletteRow]) -> [String] {
        rows.filter { $0.kind == .history }.map(\.actionURL)
    }

    private var gizmoPages: [HistoryItem] {
        [
            visit("https://example.com/a", title: "Gizmo alignment fix"),
            visit("https://example.com/b", title: "Gizmos realignment fixture", visits: 10),
        ]
    }

    /// Both pages start a title word with each term; the more visited leads.
    @Test("Repeated terms and extra spaces change nothing", .bug(id: 42))
    func repeatedTermsAndExtraSpacesChangeNothing() {
        let palette = model(gizmoPages)
        let expected = ["https://example.com/b", "https://example.com/a"]

        #expect(historyURLs(palette.rows(for: "fix gizmo")) == expected)
        #expect(historyURLs(palette.rows(for: "  fix   gizmo fix  ")) == expected)
    }

    /// The whole-query fuzzy fallback sees the normalized query too.
    @Test("Extra spaces and repeats don't change a fuzzy-only match", .bug(id: 42))
    func normalizationReachesTheFuzzyFallback() {
        let palette = model([visit("https://example.com/1", title: "SwiftUI Basics")])
        let expected = ["https://example.com/1"]

        #expect(historyURLs(palette.rows(for: "sui bsc")) == expected)
        #expect(historyURLs(palette.rows(for: "  sui   bsc sui ")) == expected)
    }

    /// A term that only matches as a scattered subsequence disqualifies the page.
    @Test("Fuzzy matching never applies to one term of a multi-term query", .bug(id: 42))
    func fuzzyNeverAppliesPerTerm() {
        let rows = model([visit("https://example.com/1", title: "SwiftUI Basics")])
            .rows(for: "basics swui")

        #expect(rows.map(\.kind) == [.search])
    }

    /// "sui bsc" matches both pages only as a whole-query subsequence. They
    /// are still found, and the dense match keeps its tier above the more
    /// frecent scattered one.
    @Test("Whole-query matches are never lost", .bug(id: 42))
    func wholeQueryMatchesAreNeverLost() {
        let rows = model([
            visit("https://example.com/scattered", title: "Super user interface bus schedule", visits: 10),
            visit("https://example.com/dense", title: "SwiftUI Basics"),
        ]).rows(for: "sui bsc")

        #expect(rows.first?.kind == .search)
        #expect(historyURLs(rows) == ["https://example.com/dense", "https://example.com/scattered"])
    }

    /// Every term of the first page starts a title word; the second page's
    /// "alignment" only sits inside "realignment". Its weakest term ranks it
    /// lower despite more visits.
    @Test("The weakest term sets an any-order match's tier", .bug(id: 42))
    func weakestTermSetsTheTier() {
        let rows = model(gizmoPages).rows(for: "fix alignment gizmo")

        #expect(historyURLs(rows) == ["https://example.com/a", "https://example.com/b"])
    }

    /// "swift basics" is a dense whole-query subsequence of both titles, but only
    /// "SwiftUI Basics" also has both words as literal title-word prefixes. That
    /// stronger tier outranks the more frecent fuzzy-only page.
    @Test("The stronger of whole-query and any-order tiers wins", .bug(id: 42))
    func strongerTierWins() {
        let rows = model([
            visit("https://example.com/fuzzy", title: "Swift basic stats", visits: 20),
            visit("https://example.com/both", title: "SwiftUI Basics", visits: 5),
        ]).rows(for: "swift basics")

        #expect(historyURLs(rows) == ["https://example.com/both", "https://example.com/fuzzy"])
    }

    @Test("Any-order rows do not depend on history order", .bug(id: 42))
    func rowsDoNotDependOnHistoryOrder() {
        let history = ["c", "a", "b"].map { visit("https://example.com/\($0)", title: "Gizmo fix") }

        let forward = historyURLs(model(history).rows(for: "fix gizmo"))
        let reversed = historyURLs(model(history.reversed()).rows(for: "fix gizmo"))

        #expect(forward == reversed)
        #expect(forward == ["https://example.com/a", "https://example.com/b", "https://example.com/c"])
    }

    /// `/A` and `/a` collapse to one page; with equal signal, the survivor
    /// is the same whichever the browser reported first.
    @Test("Case-only duplicates collapse independently of history order", .bug(id: 42))
    func caseOnlyDuplicatesCollapseDeterministically() {
        let history = [
            visit("https://example.com/Gizmo", title: "Gizmo fix"),
            visit("https://example.com/gizmo", title: "Gizmo fix"),
        ]

        let forward = historyURLs(model(history).rows(for: "fix gizmo"))
        let reversed = historyURLs(model(history.reversed()).rows(for: "fix gizmo"))

        #expect(forward == ["https://example.com/Gizmo"])
        #expect(reversed == forward)
    }

    /// Both terms hit github.com's registrable label and title, yet the whole
    /// query is not a literal domain match, so Search still leads.
    @Test("A multi-term query never puts history above Search", .bug(id: 42))
    func multiTermNeverLeadsSearch() {
        let rows = model([visit("https://github.com/", title: "GitHub hub", visits: 90)])
            .rows(for: "hub git")

        #expect(rows.map(\.kind) == [.search, .history])
    }

    @Test("Per-host cap and duplicate collapsing still apply", .bug(id: 42))
    func perHostCapAndDuplicatesStillApply() {
        let history = [
            visit("https://example.com/a", title: "Gizmo fix"),
            visit("https://www.example.com/a", title: "Gizmo fix", visits: 9),
            visit("https://example.com/b", title: "Gizmo fix"),
            visit("https://example.com/c", title: "Gizmo fix"),
            visit("https://example.com/d", title: "Gizmo fix"),
        ]

        // The more visited www. copy stands for /a; the plain copy never shows.
        #expect(historyURLs(model(history).rows(for: "fix gizmo")) == [
            "https://www.example.com/a", "https://example.com/b", "https://example.com/c",
        ])
    }
}


/// The palette settings (issue #43): `maxResults` is the whole row budget,
/// and `wordMatch` picks any-order (#42) or whole-phrase matching.
struct PaletteSettingsBehaviorTests: PaletteHistoryFixture {

    /// Twenty sites whose registrable label starts with "site", so every
    /// query below has more matches than any row budget.
    private var sites: [HistoryItem] {
        (0..<20).map { visit("https://site\($0).example/", title: "Site \($0)") }
    }

    private func palette(_ config: PaletteConfig, _ items: [HistoryItem]) -> PaletteModel {
        let palette = model(items)
        palette.config = config
        return palette
    }

    @Test(.bug(id: 43), arguments: [4, 8, 12])
    func maxResultsCountsEveryRow(_ maxResults: Int) {
        let palette = palette(PaletteConfig(maxResults: maxResults), sites)

        let typed = palette.rows(for: "site")
        #expect(typed.count == maxResults)
        #expect(typed.contains { $0.kind == .search }, "Search spends one of the rows")

        let url = palette.rows(for: "site1.example")
        #expect(url.count <= maxResults)
        #expect(url.prefix(2).map(\.kind) == [.openURL, .search])

        #expect(palette.rows(for: "").count == maxResults, "the empty palette fills the budget too")
    }

    @Test(.bug(id: 43)) func settingsRowSpendsTheBudget() {
        let rows = palette(PaletteConfig(maxResults: 4), [
            visit("https://example.com/1", title: "Settings guide"),
            visit("https://example.com/2", title: "Settings tips"),
            visit("https://example.com/3", title: "Settings faq"),
            visit("https://example.com/4", title: "Settings more"),
        ]).rows(for: "settings")

        #expect(rows.count == 4)
        #expect(rows.first?.kind == .settings)
    }

    @Test(.bug(id: 43)) func anyOrderFindsWordsOutOfOrder() {
        let rows = palette(PaletteConfig(wordMatch: .anyOrder), [
            visit("https://example.com/a", title: "Gizmo alignment fix"),
        ]).rows(for: "fix gizmo")

        #expect(rows.map(\.actionURL).contains("https://example.com/a"))
    }

    /// Phrase restores the pre-#42 matcher: the query is one string.
    @Test(.bug(id: 43)) func phraseMatchesOnlyTheWholeQuery() {
        let palette = palette(PaletteConfig(wordMatch: .phrase), [
            visit("https://example.com/a", title: "Gizmo alignment fix"),
        ])

        #expect(palette.rows(for: "fix gizmo").map(\.kind) == [.search])
        #expect(palette.rows(for: " Gizmo Alignment ").map(\.actionURL).contains("https://example.com/a"))
    }

    /// The off-main-thread ranking copy must rank with the same settings.
    @Test(.bug(id: 43)) func copyKeepsThePaletteSettings() {
        let original = palette(PaletteConfig(maxResults: 5, wordMatch: .phrase), sites)

        #expect(original.copy().config == original.config)
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

    /// A shortcut that searches the typed text whatever row is selected.
    struct ForcedSearchCase: Sendable, CustomTestStringConvertible {
        let name: String
        let hint: String
        let incognito: Bool
        let resolve: @Sendable (PaletteModel, String, PaletteRow) -> PaletteAction?
        var testDescription: String { name }
    }

    @Test(
        "Shift-Return, Command-Shift-Return, and Tab force search for the typed text",
        .bug(id: 14), .bug(id: 44),
        arguments: [
            ForcedSearchCase(name: "Shift-Return", hint: "⇧⏎ Search", incognito: false) {
                $0.action(for: $1, selectedRow: $2, chord: [.shift])
            },
            ForcedSearchCase(
                name: "Command-Shift-Return", hint: "⇧⌘⏎ Search Incognito", incognito: true
            ) {
                $0.action(for: $1, selectedRow: $2, chord: [.command, .shift])
            },
            ForcedSearchCase(name: "Tab", hint: "Search ⇥", incognito: false) { model, query, _ in
                model.tabAction(for: query)
            },
        ]
    )
    func forcedSearchUsesTheTypedText(_ shortcut: ForcedSearchCase) throws {
        let model = PaletteModel()
        model.searchEngine = SearchEngineConfig(
            name: "Kagi",
            template: "https://kagi.com/search?q=%s",
            provider: "kagi"
        )
        let selectedRow = try #require(model.rows(for: "example.com/pricing").first)

        let action = try #require(shortcut.resolve(model, "privacy news", selectedRow))

        #expect(action.kind == .search)
        #expect(action.url == "https://kagi.com/search?q=privacy%20news")
        #expect(action.incognito == shortcut.incognito)
        #expect(action.hint == shortcut.hint)
    }

    @Test("Tab does nothing for an empty query", .bug(id: 44), arguments: ["", "   "])
    func tabDoesNothingForAnEmptyQuery(_ query: String) {
        #expect(PaletteModel().tabAction(for: query) == nil)
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

/// Results that land late (issue #41): history refreshes and keystroke
/// rankings run off the main thread, and only the newest of each may land.
struct PaletteOutOfDateTests {

    private func snapshot(_ url: String) -> Ranking.HistoryIndex {
        Ranking.buildIndex(items: [HistoryItem(url: url, title: "", lastVisitTime: 0, visitCount: 1, typedCount: 0)], nowMs: 0)
    }

    @Test(.bug(id: 41)) func anOlderRefreshLandingLastLeavesTheNewerSnapshot() {
        let model = PaletteModel()
        let older = model.beginRefresh()
        let newer = model.beginRefresh()

        #expect(model.install(snapshot("https://newer.example/"), from: newer))
        #expect(!model.install(snapshot("https://older.example/"), from: older))

        #expect(model.rows(for: "").map(\.host) == ["newer.example"])
    }

    /// The controller renders only what `land(_:from:)` hands back.
    @Test(.bug(id: 41)) func aRankingForAnOlderQueryIsNotRenderedAfterANewerEdit() {
        let model = PaletteModel()
        model.install(Ranking.buildIndex(items: [
            HistoryItem(url: "https://older.example/", title: "", lastVisitTime: 0, visitCount: 1, typedCount: 0),
            HistoryItem(url: "https://newer.example/", title: "", lastVisitTime: 0, visitCount: 1, typedCount: 0),
        ], nowMs: 0), from: model.beginRefresh())
        let older = model.beginRanking()
        let olderResults = model.results(for: "older")
        let newer = model.beginRanking()
        let newerResults = model.results(for: "newer")

        #expect(model.land(olderResults, from: older) == nil)
        #expect(model.land(newerResults, from: newer)?.rows.first?.host == "newer.example")
        // Closing the palette, or Return settling the rows, outdates it too.
        model.outdateRankings()
        #expect(model.land(newerResults, from: newer) == nil)
    }

    /// A completion applies only to the field state it was ranked for: the
    /// same text, caret at the end, nothing selected.
    @MainActor
    @Test(.bug(id: 41), arguments: [
        (text: "git", selection: NSRange(location: 3, length: 0), applies: true),
        (text: "git", selection: NSRange(location: 2, length: 0), applies: false), // caret moved
        (text: "git", selection: NSRange(location: 0, length: 3), applies: false), // text selected
        (text: "gi", selection: NSRange(location: 2, length: 0), applies: false),  // edited
    ])
    func aCompletionAppliesOnlyToTheFieldStateItWasRankedFor(text: String, selection: NSRange, applies: Bool) {
        #expect(PaletteController.completionApplies(rankedFor: "git", text: text, selection: selection) == applies)
    }
}

/// The palette's selected row (keyboard, Return) and hovered row (pointer,
/// visual only) are separate states (#40). No window is involved: the pointer
/// is modeled as the hover input the controller feeds in.
struct PaletteSelectionTests {

    @Test("Pointer hover never changes the selected row or the Return action", .bug(id: 40))
    func hoverNeverChangesTheReturnAction() throws {
        let model = PaletteModel()
        var selection = PaletteSelection()

        // The pointer rests on row 1 (Search) under "example.com/pricing".
        var rows = model.rows(for: "example.com/pricing")
        selection.rowsChanged(count: rows.count, resetSelection: true)
        selection.hover(1)
        let first = try #require(model.returnAction(
            for: "example.com/pricing", rows: rows, selection: selection, chord: .plain))
        #expect(first.url == "https://example.com/pricing")
        #expect(first.hint == "⏎ Open")

        // The user types; the list rebuilds with different rows under the
        // parked pointer, which re-reports row 1 (now Search, not Settings).
        rows = model.rows(for: "settings")
        selection.rowsChanged(count: rows.count, resetSelection: true)
        selection.hover(1)
        let second = try #require(model.returnAction(
            for: "settings", rows: rows, selection: selection, chord: .plain))
        try #require(rows.count > 1)
        #expect(rows[1].kind == .search)
        #expect(second.kind == .settings)
        #expect(second.hint == "⏎ Settings")
    }

    @Test("Selected and hovered rows highlight independently; selected wins on one row", .bug(id: 40))
    func highlightsCoexistAndNeverStack() {
        var selection = PaletteSelection()
        selection.rowsChanged(count: 4, resetSelection: true)

        selection.hover(2)
        #expect((0..<4).map(selection.highlight(for:)) == [.selected, .none, .hovered, .none])

        selection.hover(0)
        #expect((0..<4).map(selection.highlight(for:)) == [.selected, .none, .none, .none])

        selection.hover(nil)
        #expect((0..<4).map(selection.highlight(for:)) == [.selected, .none, .none, .none])
    }

    @Test("Arrow keys move from the selected row, not the hovered one", .bug(id: 40))
    func arrowsMoveFromTheSelectedRow() {
        var selection = PaletteSelection()
        selection.rowsChanged(count: 4, resetSelection: true)
        selection.hover(3)

        selection.move(.down)
        #expect(selection.selected == 1)
        selection.move(.up)
        selection.move(.up)
        #expect(selection.selected == 3)  // wraps
    }

    @Test("Clicking a row selects it", .bug(id: 40))
    func clickSelectsTheRow() {
        var selection = PaletteSelection()
        selection.rowsChanged(count: 4, resetSelection: true)
        selection.hover(2)

        selection.click(2)

        #expect(selection.selected == 2)
        #expect(selection.highlight(for: 2) == .selected)
    }
}
