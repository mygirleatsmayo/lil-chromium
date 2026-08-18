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

/// Row ORDER around the Search action (issue #13).
///
/// The rule under test: for non-empty, non-URL text, only a contiguous literal
/// match inside a history entry's registrable domain may sit above Search.
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
