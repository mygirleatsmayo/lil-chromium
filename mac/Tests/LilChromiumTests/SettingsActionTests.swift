import Foundation
import Testing
@testable import LilChromiumApp
@testable import LilShared

/// The dedicated Settings URL/action is protocol surface: the host launches it
/// targeted at Lil Chromium, and the app recognizes it before HTTP routing.
struct SettingsActionTests {

    @Test func dedicatedURLTargetsLilChromiumNotABrowser() {
        #expect(SettingsAction.urlString == "lilchromium://settings")
        #expect(SettingsAction.bundleId == "com.lilchromium.app")
        #expect(SettingsAction.openArguments == ["-b", "com.lilchromium.app", "lilchromium://settings"])
    }

    @Test(arguments: [
        "lilchromium://settings",
        "LILCHROMIUM://SETTINGS",
        "lilchromium://settings/",
    ])
    func dedicatedSettingsURLsMatch(_ url: String) {
        #expect(SettingsAction.matches(url))
        #expect(URLIntent.destination(for: url) == .settings)
    }

    @Test(arguments: [
        "https://example.com",
        "http://example.com/settings",
        "https://lilchromium://settings",
        "lilchromium://open",
        "lilchromium://settings/extra",
        "file:///tmp/page.html",
        "",
    ])
    func ordinaryURLsStayOrdinaryRouting(_ url: String) {
        #expect(SettingsAction.matches(url) == false)
        #expect(URLIntent.destination(for: url) == .open(url))
    }

    @Test func protocolAndBundleDeclareTheDedicatedAction() throws {
        let root = Fixture.directory.deletingLastPathComponent()
        let protocolText = try String(
            contentsOf: root.appendingPathComponent("docs/PROTOCOL.md"),
            encoding: .utf8
        )
        let bundleScript = try String(
            contentsOf: root.appendingPathComponent("scripts/bundle-app.sh"),
            encoding: .utf8
        )

        #expect(protocolText.contains("`open-settings`"))
        #expect(protocolText.contains("`lilchromium://settings`"))
        #expect(protocolText.contains("`com.lilchromium.app`"))
        #expect(bundleScript.contains("<string>lilchromium</string>"))
        #expect(bundleScript.contains("BUNDLE_ID=\"com.lilchromium.app\""))
    }
}
