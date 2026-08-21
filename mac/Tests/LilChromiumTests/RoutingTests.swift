import Testing
@testable import LilChromiumApp
@testable import LilShared

/// The app's routing order from docs/PROTOCOL.md, "App routing order":
///   1. relay-<primaryBrowser>.sock
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
            primaryBrowser: "helium",
            fallbackBrowser: "chrome",
            liveSlugs: ["brave", "chrome", "vivaldi"]   // newest mtime first
        )

        #expect(order == ["helium", "chrome", "brave", "vivaldi"])
    }

    /// The primary browser leads even when its socket is not currently live —
    /// the connect attempt is what decides, not the directory listing.
    @Test func primaryLeadsEvenWithNoLiveSockets() {
        #expect(
            RelayClient.socketOrder(primaryBrowser: "helium", fallbackBrowser: "chrome", liveSlugs: [])
                == ["helium", "chrome"]
        )
    }

    /// One browser is never tried twice, however it appears.
    @Test func duplicateTargetsCollapse() {
        #expect(
            RelayClient.socketOrder(
                primaryBrowser: "brave",
                fallbackBrowser: "brave",
                liveSlugs: ["brave", "chrome-beta"]
            ) == ["brave", "chrome-beta"]
        )
    }

    @Test func identicalLegacyLaunchTargetsStillReachAnotherInstallation() {
        var cfg = LilConfig.defaults
        cfg.primaryBrowser = "brave"
        cfg.fallbackBrowser = "brave"
        cfg.knownBrowsers = [
            KnownBrowser(slug: "brave", name: "Brave", bundleId: "com.brave.Browser", installed: true),
            KnownBrowser(slug: "chrome", name: "Google Chrome", bundleId: "com.google.Chrome", installed: true),
        ]

        #expect(OpenRouter.launchBundleIds(config: cfg) == ["com.brave.Browser", "com.google.Chrome"])
    }

    @Test func siblingChannelsRemainDistinctRelayTargets() {
        #expect(
            RelayClient.socketOrder(
                primaryBrowser: "chrome",
                fallbackBrowser: "chrome-beta",
                liveSlugs: ["chrome-beta", "chrome"]
            ) == ["chrome", "chrome-beta"]
        )
    }

    /// An unset primary or fallback is skipped, not turned into "relay-.sock".
    @Test func emptySlugsAreDropped() {
        #expect(
            RelayClient.socketOrder(primaryBrowser: "", fallbackBrowser: "chrome", liveSlugs: ["", "arc"])
                == ["chrome", "arc"]
        )
    }

    // MARK: - Config broadcast (issue #12 hot-apply)

    /// A Settings write converges on EVERY live relay, ignoring the routing
    /// preference order: slug-sorted, deduped, no empties — a normalized
    /// order both the implementation and its tests can rely on.
    @Test func broadcastReachesEveryLiveRelayInNormalizedOrder() {
        #expect(
            RelayClient.broadcastTargets(liveSlugs: ["vivaldi", "chrome", "brave", "chrome", ""])
                == ["brave", "chrome", "vivaldi"]
        )
    }

    /// No live relays means no targets — the write still lands in config.json
    /// and each relay catches up from the file when its extension reconnects.
    @Test func broadcastTargetsEmptyWhenNoRelaysLive() {
        #expect(RelayClient.broadcastTargets(liveSlugs: []) == [])
    }

    // MARK: - Steps 4-5: direct browser launch

    /// With no relay answering, the app launches browsers in the same preference
    /// order and never bare-opens the URL (it is the system default handler).
    @Test func launchOrderIsPrimaryFallbackThenInstalled() {
        var cfg = LilConfig.defaults
        cfg.primaryBrowser = "helium"
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

    /// The installation slug is canonical: a stale known-browser row cannot
    /// silently turn the stable channel into its Beta sibling.
    @Test func siblingChannelsKeepTheirCatalogBundleIdentity() {
        var cfg = LilConfig.defaults
        cfg.primaryBrowser = "chrome"
        cfg.fallbackBrowser = "chrome-beta"
        cfg.knownBrowsers = [
            KnownBrowser(slug: "chrome", name: "Google Chrome", bundleId: "com.google.Chrome.beta", installed: true),
            KnownBrowser(slug: "chrome-beta", name: "Google Chrome Beta", bundleId: "com.google.Chrome", installed: true),
        ]

        #expect(OpenRouter.launchBundleIds(config: cfg) == ["com.google.Chrome", "com.google.Chrome.beta"])
    }

    /// A supported but uninstalled Primary is attempted before Fallback and
    /// another installed browser; the launcher advances when it cannot resolve
    /// that first bundle id, so the URL remains in the same ordered operation.
    @Test func missingPrimaryStillKeepsFallbackAndInstalledCandidates() {
        var cfg = LilConfig.defaults
        cfg.primaryBrowser = "chrome-beta"
        cfg.fallbackBrowser = "chrome"
        cfg.knownBrowsers = [
            KnownBrowser(slug: "chrome-beta", name: "Google Chrome Beta", bundleId: "com.google.Chrome.beta", installed: false),
            KnownBrowser(slug: "chrome", name: "Google Chrome", bundleId: "com.google.Chrome", installed: true),
            KnownBrowser(slug: "brave", name: "Brave", bundleId: "com.brave.Browser", installed: true),
        ]

        #expect(
            OpenRouter.launchBundleIds(config: cfg)
                == ["com.google.Chrome.beta", "com.google.Chrome", "com.brave.Browser"]
        )
    }
}
