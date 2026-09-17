import Testing
@testable import lilchromium_host

/// ADR-0004 (issue #31): when a lil closes to "outside the browser", the host
/// must know which app that is. The history answers with the last regular app
/// the user activated that is not the browser hosting this relay.
@MainActor
struct ActivationHistoryTests {

    private let browser = ActivatedApp(pid: 100, bundleId: "net.imput.helium")
    private let mail = ActivatedApp(pid: 200, bundleId: "com.apple.mail")
    private let finder = ActivatedApp(pid: 300, bundleId: "com.apple.finder")

    @Test(.bug(id: 31)) func remembersTheLastAppActivatedOutsideTheBrowser() {
        let history = ActivationHistory(browserBundleIds: ["net.imput.helium"])

        history.note(mail)
        history.note(finder)

        #expect(history.lastExternal == finder)
    }

    /// Bringing the browser forward (to click a lil) is the activation that
    /// ends the user's stay in the other app; it must not erase which app that was.
    @Test(.bug(id: 31)) func theBrowsersOwnActivationKeepsTheAppTheUserCameFrom() {
        let history = ActivationHistory(browserBundleIds: ["net.imput.helium"])

        history.note(mail)
        history.note(browser)

        #expect(history.lastExternal == mail)
    }
}
