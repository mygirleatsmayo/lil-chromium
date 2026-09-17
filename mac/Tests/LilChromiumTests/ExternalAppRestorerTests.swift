import Testing
@testable import lilchromium_host

/// ADR-0004 (issue #31): which process a restore-focus request brings forward.
/// The host's live activation history is the truth; the process the app
/// recorded when the lil opened is only the last resort without one.
struct ExternalAppRestorerTests {

    private let mail = ActivatedApp(pid: 4242, bundleId: "com.apple.mail")
    private let finder = ActivatedApp(pid: 300, bundleId: "com.apple.finder")

    @Test(.bug(id: 31)) func theActivationHistoryWinsOverARecordedProcess() {
        #expect(ExternalAppRestorer.target(pid: 4242, bundleId: "com.apple.mail", history: finder) == finder)
    }

    @Test(.bug(id: 31)) func withoutHistoryTheRecordedProcessIsTheLastResort() {
        #expect(ExternalAppRestorer.target(pid: 4242, bundleId: "com.apple.mail", history: nil) == mail)
    }

    @Test(.bug(id: 31)) func nothingIsBroughtForwardWithoutEither() {
        #expect(ExternalAppRestorer.target(pid: nil, bundleId: nil, history: nil) == nil)
    }
}
