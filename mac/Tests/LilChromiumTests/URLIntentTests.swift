import XCTest
@testable import LilChromiumApp
@testable import LilShared

/// What typed text means: a destination to open, or a query to search for.
/// Shared by the palette and (mirrored) the lil hover-bar omnibox.
final class URLIntentTests: XCTestCase {

    func testTextWithASchemeOrADotIsADestination() {
        XCTAssertTrue(URLIntent.looksLikeURL("https://example.com/docs"))
        XCTAssertTrue(URLIntent.looksLikeURL("file:///Users/me/page.html"))
        XCTAssertTrue(URLIntent.looksLikeURL("example.com"))
        XCTAssertTrue(URLIntent.looksLikeURL("sub.domain.co/path?q=1"))
        XCTAssertTrue(URLIntent.looksLikeURL("  example.com  "), "surrounding whitespace is not input")
    }

    func testEverythingElseIsAQuery() {
        XCTAssertFalse(URLIntent.looksLikeURL("hacker news"), "a space always means search")
        XCTAssertFalse(URLIntent.looksLikeURL("what is 2.5 in binary"), "a dot inside a phrase is still a phrase")
        XCTAssertFalse(URLIntent.looksLikeURL("swift"))
        XCTAssertFalse(URLIntent.looksLikeURL(".com"), "a leading dot is not a host")
        XCTAssertFalse(URLIntent.looksLikeURL("example."), "a trailing dot is not a host")
        XCTAssertFalse(URLIntent.looksLikeURL(""))
        XCTAssertFalse(URLIntent.looksLikeURL("   "))
    }

    func testNormalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() {
        XCTAssertEqual(URLIntent.normalizedURL("example.com"), "https://example.com")
        XCTAssertEqual(URLIntent.normalizedURL("  example.com/a b  "), "https://example.com/a b")
        XCTAssertEqual(URLIntent.normalizedURL("http://example.com"), "http://example.com")
        XCTAssertEqual(URLIntent.normalizedURL("file:///tmp/x.html"), "file:///tmp/x.html")
    }

    func testDisplayHostDropsWWWAndFailsClosed() {
        XCTAssertEqual(URLIntent.hostForDisplay("https://www.example.com/a/b"), "example.com")
        XCTAssertEqual(URLIntent.hostForDisplay("https://kagi.com/search?q=x"), "kagi.com")
        XCTAssertNil(URLIntent.hostForDisplay("not a url"))
    }

    // MARK: - Search templates

    /// `%s` is where the query goes, percent-encoded.
    func testSearchTemplateSubstitutesTheEncodedQuery() {
        XCTAssertEqual(
            SearchEngineConfig.defaults.searchURL(for: "lil chromium"),
            "https://www.google.com/search?q=lil%20chromium"
        )
        XCTAssertEqual(
            SearchEngineConfig(name: "Kagi", template: "https://kagi.com/search?q=%s").searchURL(for: "café"),
            "https://kagi.com/search?q=caf%C3%A9"
        )
    }

    /// A custom template the user set from a config fixture works the same way.
    func testConfiguredSearchEngineIsUsed() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")

        XCTAssertEqual(cfg.searchEngine.name, "Kagi")
        XCTAssertEqual(cfg.searchEngine.searchURL(for: "swift 6"), "https://kagi.com/search?q=swift%206")
    }

    /// Whitespace around the query never reaches the search engine.
    func testSearchTemplateTrimsTheQuery() {
        XCTAssertEqual(
            SearchEngineConfig.defaults.searchURL(for: "  swift  "),
            "https://www.google.com/search?q=swift"
        )
    }

    /// A template with no placeholder cannot carry a query — fall back to Google
    /// rather than opening the bare template.
    func testTemplateWithoutPlaceholderFallsBackToGoogle() {
        let broken = SearchEngineConfig(name: "Broken", template: "https://example.com/search")

        XCTAssertEqual(broken.searchURL(for: "swift"), "https://www.google.com/search?q=swift")
    }
}
