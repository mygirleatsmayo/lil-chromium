import Testing
@testable import lilchromium_host

/// ADR-0004 (issue #31): which process a restore-focus request brings forward.
struct ExternalAppRestorerTests {

    private let mail = ActivatedApp(pid: 4242, bundleId: "com.apple.mail")
    private let finder = ActivatedApp(pid: 300, bundleId: "com.apple.finder")

    /// A process the app recorded at open time is exact; the history is not consulted.
    @Test(.bug(id: 31)) func aRecordedProcessWinsOverTheHistory() {
        #expect(ExternalAppRestorer.target(pid: 4242, bundleId: "com.apple.mail", history: finder) == mail)
    }

    @Test(.bug(id: 31)) func withoutARecordedProcessTheHistoryDecides() {
        #expect(ExternalAppRestorer.target(pid: nil, bundleId: nil, history: finder) == finder)
    }

    @Test(.bug(id: 31)) func nothingIsBroughtForwardWithoutEither() {
        #expect(ExternalAppRestorer.target(pid: nil, bundleId: nil, history: nil) == nil)
    }
}
