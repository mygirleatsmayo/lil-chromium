import Testing
@testable import LilChromiumApp
@testable import LilShared

/// What typed text means: a destination to open, or a query to search for.
/// Shared by the palette and (mirrored) the lil hover-bar omnibox.
struct URLIntentTests {

    /// One contract for the palette and the hoverbar (PROTOCOL.md *URL
    /// intent*); the extension suite runs the same fixture.
    @Test(.bug(id: 39)) func typedTextFollowsTheSharedContract() throws {
        let fixture = try Fixture.decode(URLIntentFixture.self, from: "url-intent")
        for c in fixture.cases {
            #expect(URLIntent.intent(of: c.input, home: "/nowhere") == c.expected, "\(c.input)")
        }
    }

    /// `~` names the user's home directory, which only the app can know.
    @Test(.bug(id: 39)) func homeDirectoryPathsOpenTheFileUnderHome() throws {
        let home = try Fixture.decode(URLIntentFixture.self, from: "url-intent").home
        for c in home.cases {
            #expect(URLIntent.intent(of: c.input, home: home.directory) == c.expected, "\(c.input)")
        }
    }

    @Test func displayHostDropsWWWAndFailsClosed() {
        #expect(URLIntent.hostForDisplay("https://www.example.com/a/b") == "example.com")
        #expect(URLIntent.hostForDisplay("https://kagi.com/search?q=x") == "kagi.com")
        #expect(URLIntent.hostForDisplay("not a url") == nil)
    }

    /// A history row's field text follows Chrome's `fill_into_edit` (#38 P2
    /// amended): `FormatUrl` with `kFormatUrlOmitDefaults`.
    @Test(.bug(id: 38), arguments: [
        ("https://github.com/", "git", "https://github.com"),
        ("https://www.example.com/a/", "ex", "https://www.example.com/a/"),
        ("http://example.com/", "ex", "example.com"),
        ("http://example.com:8080/", "ex", "example.com:8080"),
        ("http://example.com/?q=1", "ex", "example.com/?q=1"),
        ("https://me:pw@example.com/a%20b?q=c%20d#e%20f", "ex", "https://example.com/a b?q=c d#e f"),
        ("http://example.com/", "foo http", "http://example.com"),
        ("http://ftp.example.com/", "ex", "http://ftp.example.com"),
        ("http://example./", "ex", "example./"),
        ("not a url", "x", "not a url"),
    ])
    func historyFieldTextMatchesChrome(_ url: String, _ typed: String, _ shown: String) {
        #expect(URLIntent.fieldText(forHistoryURL: url, typed: typed) == shown)
    }

    // MARK: - Search templates

    /// `%s` is where the query goes, percent-encoded.
    @Test func searchTemplateSubstitutesTheEncodedQuery() {
        #expect(
            SearchEngineConfig.defaults.searchURL(for: "lil chromium")
                == "https://www.startpage.com/sp/search?query=lil%20chromium"
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
                == "https://www.startpage.com/sp/search?query=swift"
        )
    }

    /// A template with no placeholder cannot carry a query — fall back to the
    /// default (Startpage) template rather than opening the bare template.
    @Test func templateWithoutPlaceholderFallsBackToDefault() {
        let broken = SearchEngineConfig(name: "Broken", template: "https://example.com/search")

        #expect(broken.searchURL(for: "swift") == "https://www.startpage.com/sp/search?query=swift")
        #expect(broken.provider == "custom")
    }
}

/// `fixtures/url-intent.json`: each case names its input and either the URL it
/// opens, `search`, or `none`.
private struct URLIntentFixture: Decodable {
    struct Case: Decodable {
        let input: String
        let open: String?
        let search: Bool?
        let none: Bool?

        /// Nil for a malformed case, which then matches no intent and fails.
        var expected: URLIntent.Intent? {
            if let open { return .open(open) }
            if search == true { return .search }
            return none == true ? .empty : nil
        }
    }

    let cases: [Case]
    let home: Home

    struct Home: Decodable {
        let directory: String
        let cases: [Case]
    }
}
