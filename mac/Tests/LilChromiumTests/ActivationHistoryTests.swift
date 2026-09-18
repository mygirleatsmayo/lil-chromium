import AppKit
import Testing
import LilShared

/// ADR-0004 (issue #31): when a lil closes to "outside the browser", the host
/// must know which app that is. The history answers with the last regular app
/// the user activated that is not the browser hosting this relay.
@MainActor
struct ActivationHistoryTests {

    private let browser = ActivatedApp(pid: 100, bundleId: "net.imput.helium")
    private let mail = ActivatedApp(pid: 200, bundleId: "com.apple.mail")
    private let finder = ActivatedApp(pid: 300, bundleId: "com.apple.finder")

    @Test(.bug(id: 31)) func remembersTheLastAppActivatedOutsideTheBrowser() {
        let history = ActivationHistory(excluding: ["net.imput.helium"])

        history.note(mail, policy: .regular)
        history.note(finder, policy: .regular)

        #expect(history.lastExternal == finder)
    }

    /// An app that quit is no longer somewhere the user can return to; the
    /// history falls back to the app they were in before it.
    @Test(.bug(id: 31)) func aQuitAppFallsOutOfTheHistory() {
        let history = ActivationHistory(excluding: ["net.imput.helium"])

        history.note(mail, policy: .regular)
        history.note(finder, policy: .regular)
        history.forget(pid: finder.pid)

        #expect(history.lastExternal == mail)
    }

    /// The palette scenario (#31 QA addendum): LilChromiumApp is an accessory
    /// app, so its activation over Mail must not make it the place to return to.
    @Test(.bug(id: 31)) func anAccessoryAppActivatingOverTheUsersAppIsPassedOver() {
        let history = ActivationHistory(excluding: ["net.imput.helium"])

        history.note(mail, policy: .regular)
        history.note(ActivatedApp(pid: 400, bundleId: "com.lilchromium.app"), policy: .accessory)

        #expect(history.lastExternal == mail)
    }

    /// Bringing the browser forward (to click a lil) is the activation that
    /// ends the user's stay in the other app; it must not erase which app that was.
    @Test(.bug(id: 31)) func theBrowsersOwnActivationKeepsTheAppTheUserCameFrom() {
        let history = ActivationHistory(excluding: ["net.imput.helium"])

        history.note(mail, policy: .regular)
        history.note(browser, policy: .regular)

        #expect(history.lastExternal == mail)
    }
}
