import Foundation
import Testing
@testable import lilchromium_host

/// Host log lines are read against the extension trace, whose `t` is a
/// millisecond epoch: a `restore-focus` line has to say which millisecond it
/// landed in (issue #31 live run).
struct HostLogTests {

    @Test(.bug(id: 31)) func stampsCarryMilliseconds() {
        // `date -u -r 1789687813` → 2026-09-17T23:30:13Z
        let date = Date(timeIntervalSince1970: 1_789_687_813.417)
        #expect(HostLog.stamp(date) == "2026-09-17T23:30:13.417Z")
    }
}
