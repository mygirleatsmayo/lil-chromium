import Testing
@testable import LilChromiumApp
@testable import LilShared

/// The app's routing order from docs/PROTOCOL.md, "App routing order":
///   1. relay-<defaultBrowser>.sock
///   2. relay-<fallbackBrowser>.sock
///   3. any other relay-*.sock present (newest mtime first)
///   4./5. launch the primary browser, then the fallback, then any installed one.
///
/// Order is decided by pure functions over a config snapshot and a list of live
/// sockets, so these tests never touch a real socket or the user's config.
struct RoutingOrderTests {

    // MARK: - Steps 1-3: relay sockets

    @Test func primaryThenFallbackThenOtherLiveHosts() {
        let order = RelayClient.socketOrder(
            defaultBrowser: "helium",
            fallbackBrowser: "chrome",
            liveSlugs: ["brave", "chrome", "vivaldi"]   // newest mtime first
        )

        #expect(order == ["helium", "chrome", "brave", "vivaldi"])
    }

    /// The primary browser leads even when its socket is not currently live —
    /// the connect attempt is what decides, not the directory listing.
    @Test func primaryLeadsEvenWithNoLiveSockets() {
        #expect(
            RelayClient.socketOrder(defaultBrowser: "helium", fallbackBrowser: "chrome", liveSlugs: [])
                == ["helium", "chrome"]
        )
    }

    /// One browser is never tried twice, however it appears.
    @Test func duplicateTargetsCollapse() {
        #expect(
            RelayClient.socketOrder(defaultBrowser: "brave", fallbackBrowser: "brave", liveSlugs: ["brave"])
                == ["brave"]
        )
    }

    /// An unset primary or fallback is skipped, not turned into "relay-.sock".
    @Test func emptySlugsAreDropped() {
        #expect(
            RelayClient.socketOrder(defaultBrowser: "", fallbackBrowser: "chrome", liveSlugs: ["", "arc"])
                == ["chrome", "arc"]
        )
    }

    // MARK: - Steps 4-5: direct browser launch

    /// With no relay answering, the app launches browsers in the same preference
    /// order and never bare-opens the URL (it is the system default handler).
    @Test func launchOrderIsPrimaryFallbackThenInstalled() {
        var cfg = LilConfig.defaults
        cfg.defaultBrowser = "helium"
        cfg.fallbackBrowser = "chrome"
        cfg.knownBrowsers = [
            KnownBrowser(slug: "vivaldi", name: "Vivaldi", bundleId: "com.vivaldi.Vivaldi", installed: false),
            KnownBrowser(slug: "brave", name: "Brave", bundleId: "com.brave.Browser", installed: true),
            KnownBrowser(slug: "chrome", name: "Google Chrome", bundleId: "com.google.Chrome", installed: true),
        ]

        #expect(
            OpenRouter.launchBundleIds(config: cfg)
                == ["net.imput.helium", "com.google.Chrome", "com.brave.Browser"],
            "primary, fallback, then installed browsers; uninstalled ones are never launched"
        )
    }

    /// A browser installation recorded in the config wins over the built-in
    /// table, so a relocated or channel-specific install is still launchable.
    @Test func configBundleIdBeatsTheBuiltInTable() {
        var cfg = LilConfig.defaults
        cfg.defaultBrowser = "chrome"
        cfg.fallbackBrowser = ""
        cfg.knownBrowsers = [
            KnownBrowser(slug: "chrome", name: "Chrome Beta", bundleId: "com.google.Chrome.beta", installed: true)
        ]

        #expect(OpenRouter.launchBundleIds(config: cfg) == ["com.google.Chrome.beta"])
    }

    /// An unrecognized slug has no bundle id: it drops out instead of producing
    /// a launch that cannot work.
    @Test func unknownSlugContributesNothing() {
        var cfg = LilConfig.defaults
        cfg.defaultBrowser = "unknown"
        cfg.fallbackBrowser = "netscape"
        cfg.knownBrowsers = []

        #expect(OpenRouter.launchBundleIds(config: cfg) == [])
    }
}
