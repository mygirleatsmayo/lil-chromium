import XCTest
@testable import LilChromiumApp
@testable import LilShared

/// What the palette shows for a query. The model is fed a history snapshot and a
/// search engine directly, so no live browser, socket, or config file is
/// involved and ranking is deterministic (history times are compared against a
/// fixed "now").
final class PaletteRowsTests: XCTestCase {

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
    func testPartialSiteNameRanksTheOriginFirst() throws {
        let rows = try makeModel().rows(for: "gi")

        XCTAssertEqual(rows.first?.kind, .history)
        XCTAssertEqual(rows.first?.actionURL, "https://github.com")
        XCTAssertEqual(rows.first?.subtitle, "github.com")
    }

    /// The search row always sits at position 2 for a non-URL query, built from
    /// the configured search engine.
    func testSearchRowFollowsTheTopHit() throws {
        let rows = try makeModel().rows(for: "gi")

        XCTAssertEqual(rows[1].kind, .search)
        XCTAssertEqual(rows[1].title, "Search Kagi for “gi”")
        XCTAssertEqual(rows[1].actionURL, "https://kagi.com/search?q=gi")
        XCTAssertEqual(rows[1].subtitle, "kagi.com")
    }

    /// A query nothing matches still offers a search — the palette never dead-ends.
    func testUnmatchedQueryOffersOnlySearch() throws {
        let rows = try makeModel().rows(for: "quarterly budget review")

        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].kind, .search)
        XCTAssertEqual(rows[0].actionURL, "https://kagi.com/search?q=quarterly%20budget%20review")
    }

    /// URL-ish input replaces the top hit with an explicit "Open …" row, with the
    /// scheme filled in.
    func testURLInputLeadsWithAnOpenRow() throws {
        let rows = try makeModel().rows(for: "docs.swift.org/guide")

        XCTAssertEqual(rows[0].kind, .openURL)
        XCTAssertEqual(rows[0].title, "Open docs.swift.org/guide")
        XCTAssertEqual(rows[0].actionURL, "https://docs.swift.org/guide")
        XCTAssertEqual(rows[1].kind, .search, "search stays available for URL-ish input")
    }

    /// One chatty site cannot flood the list, and `www.` is not a separate site.
    func testOneSiteCannotFloodTheList() throws {
        let rows = try makeModel().rows(for: "example")

        XCTAssertEqual(rows.filter { $0.host == "example.com" }.count, 3, "at most 3 rows per host")
        XCTAssertEqual(Set(rows.map(\.actionURL)).count, rows.count, "no row repeats a URL")
        XCTAssertEqual(rows.first?.actionURL, "https://example.com")
    }

    /// The same page revisited with drifting query strings is one destination,
    /// not three near-identical rows.
    func testNearDuplicatePagesShowOnce() throws {
        let rows = try makeModel().rows(for: "posts")

        let pages = rows.filter { $0.kind == .history }
        XCTAssertEqual(pages.count, 1, "?q=sys / ?q=syst / ?q=syste are one page")
        XCTAssertTrue(try XCTUnwrap(pages.first).actionURL.contains("example.com/posts"))
    }

    /// An empty palette lists frequent sites and offers no search row.
    func testEmptyQueryListsFrequentSitesWithoutASearchRow() throws {
        let rows = try makeModel().rows(for: "")

        XCTAssertFalse(rows.isEmpty)
        XCTAssertTrue(rows.allSatisfy { $0.kind == .history })
        XCTAssertEqual(rows.first?.actionURL, "https://github.com", "most frecent site leads")
        XCTAssertLessThanOrEqual(rows.count, 8)
    }

    /// Inline autocomplete only offers a host that actually prefixes the query.
    func testAutocompleteOffersOnlyAPrefixedHost() throws {
        let model = try makeModel()

        XCTAssertEqual(model.autocompleteHost(for: "git"), "github.com")
        XCTAssertNil(model.autocompleteHost(for: "quarterly budget review"))
    }
}
