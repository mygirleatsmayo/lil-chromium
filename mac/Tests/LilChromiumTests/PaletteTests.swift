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
