import Testing
@testable import LilChromiumApp
@testable import LilShared

/// What typed text means: a destination to open, or a query to search for.
/// Shared by the palette and (mirrored) the lil hover-bar omnibox.
struct URLIntentTests {

    @Test func textWithASchemeOrADotIsADestination() {
        #expect(URLIntent.looksLikeURL("https://example.com/docs"))
        #expect(URLIntent.looksLikeURL("file:///Users/me/page.html"))
        #expect(URLIntent.looksLikeURL("example.com"))
        #expect(URLIntent.looksLikeURL("sub.domain.co/path?q=1"))
        #expect(URLIntent.looksLikeURL("  example.com  "), "surrounding whitespace is not input")
    }

    @Test func everythingElseIsAQuery() {
        #expect(URLIntent.looksLikeURL("hacker news") == false, "a space always means search")
        #expect(URLIntent.looksLikeURL("what is 2.5 in binary") == false, "a dot inside a phrase is still a phrase")
        #expect(URLIntent.looksLikeURL("swift") == false)
        #expect(URLIntent.looksLikeURL(".com") == false, "a leading dot is not a host")
        #expect(URLIntent.looksLikeURL("example.") == false, "a trailing dot is not a host")
        #expect(URLIntent.looksLikeURL("") == false)
        #expect(URLIntent.looksLikeURL("   ") == false)
    }

    @Test func normalizationAddsHTTPSOnlyWhenNoSchemeIsGiven() {
        #expect(URLIntent.normalizedURL("example.com") == "https://example.com")
        #expect(URLIntent.normalizedURL("  example.com/a b  ") == "https://example.com/a b")
        #expect(URLIntent.normalizedURL("http://example.com") == "http://example.com")
        #expect(URLIntent.normalizedURL("file:///tmp/x.html") == "file:///tmp/x.html")
    }

    @Test func displayHostDropsWWWAndFailsClosed() {
        #expect(URLIntent.hostForDisplay("https://www.example.com/a/b") == "example.com")
        #expect(URLIntent.hostForDisplay("https://kagi.com/search?q=x") == "kagi.com")
        #expect(URLIntent.hostForDisplay("not a url") == nil)
    }

    // MARK: - Search templates

    /// `%s` is where the query goes, percent-encoded.
    @Test func searchTemplateSubstitutesTheEncodedQuery() {
        #expect(
            SearchEngineConfig.defaults.searchURL(for: "lil chromium")
                == "https://www.google.com/search?q=lil%20chromium"
        )
        #expect(
            SearchEngineConfig(name: "Kagi", template: "https://kagi.com/search?q=%s").searchURL(for: "café")
                == "https://kagi.com/search?q=caf%C3%A9"
        )
    }

    /// A custom template the user set from a config fixture works the same way.
    @Test func configuredSearchEngineIsUsed() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")

        #expect(cfg.searchEngine.name == "Kagi")
        #expect(cfg.searchEngine.searchURL(for: "swift 6") == "https://kagi.com/search?q=swift%206")
    }

    /// Whitespace around the query never reaches the search engine.
    @Test func searchTemplateTrimsTheQuery() {
        #expect(
            SearchEngineConfig.defaults.searchURL(for: "  swift  ")
                == "https://www.google.com/search?q=swift"
        )
    }

    /// A template with no placeholder cannot carry a query — fall back to Google
    /// rather than opening the bare template.
    @Test func templateWithoutPlaceholderFallsBackToGoogle() {
        let broken = SearchEngineConfig(name: "Broken", template: "https://example.com/search")

        #expect(broken.searchURL(for: "swift") == "https://www.google.com/search?q=swift")
    }
}
