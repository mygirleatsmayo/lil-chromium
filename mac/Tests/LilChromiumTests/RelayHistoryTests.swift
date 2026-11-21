import Foundation
import Testing
@testable import LilChromiumApp
@testable import LilShared
@testable import lilchromium_host

/// The palette's history snapshot over a real relay socket (issue #41): the
/// host's own `SocketServer` on one side, the app's `RelayClient` on the other.
struct RelayHistoryTests {

    /// A full-window reply is tens of thousands of rows and several megabytes,
    /// and the browser may take seconds to gather it. Neither may turn it into
    /// an empty or cut-off result.
    @Test(.bug(id: 41)) func aSlowMultiMegabyteHistoryReplyArrivesIntact() throws {
        let count = 30_000
        let items = (0..<count).map { i in
            HistoryItem(
                url: "https://site\(i).example/" + String(repeating: "p", count: 200),
                title: "Page \(i) " + String(repeating: "t", count: 60),
                lastVisitTime: Double(i), visitCount: 1, typedCount: 0
            )
        }
        // Short path: sun_path holds 104 bytes.
        let path = "/tmp/lil-test-\(getpid())-\(UInt32.random(in: 0...UInt32.max)).sock"
        let server = SocketServer(path: path)
        try #require(server.bindAndListen().ok)
        defer { server.stop() }
        server.onLine = { line, conn in
            guard let query = try? LilCodec.decodeLine(HistoryQueryMessage.self, from: line) else { return }
            // Longer than any single-read timeout the client used to allow.
            Thread.sleep(forTimeInterval: 2.5)
            let reply = try! LilCodec.encodeLine(HistoryResultMessage(id: query.id, items: items))
            #expect(reply.count > 8 * 1024 * 1024, "the reply must exceed the old 8 MB read cap")
            conn.writeLine(reply)
        }
        server.start()

        let received = try RelayClient.historyQuery(.historyWindow(id: "q-1"), socketPath: path)

        #expect(received.count == count)
        #expect(received.last == items.last)
    }

    /// A relay that reports a failure (no extension connected, or a failed
    /// search) is a failure to the app, so the palette keeps its snapshot.
    @Test(.bug(id: 41)) func aReportedFailureIsNotAnEmptyHistory() throws {
        let path = "/tmp/lil-test-\(getpid())-\(UInt32.random(in: 0...UInt32.max)).sock"
        let server = SocketServer(path: path)
        try #require(server.bindAndListen().ok)
        defer { server.stop() }
        server.onLine = { line, conn in
            guard let query = try? LilCodec.decodeLine(HistoryQueryMessage.self, from: line),
                  let reply = try? LilCodec.encodeLine(HistoryResultMessage.failed(id: query.id, .extensionDisconnected))
            else { return }
            conn.writeLine(reply)
        }
        server.start()

        #expect(throws: RelayClient.RelayError.reportedFailure) {
            try RelayClient.historyQuery(.historyWindow(id: "q-2"), socketPath: path)
        }
    }

    /// The reply cap bounds the line itself: a line exactly at the cap is
    /// read, one byte over is rejected, never accepted.
    @Test(.bug(id: 41), arguments: [(length: 16, accepted: true), (length: 17, accepted: false)])
    func aReplyLineIsReadUpToTheCapAndNoFurther(length: Int, accepted: Bool) throws {
        var fds: [Int32] = [0, 0]
        // Fail before touching either descriptor: both start at 0 (stdin).
        try #require(socketpair(AF_UNIX, SOCK_STREAM, 0, &fds) == 0)
        defer { close(fds[0]) }
        let line = Data(repeating: UInt8(ascii: "x"), count: length) + Data([0x0A])
        let written = line.withUnsafeBytes { write(fds[1], $0.baseAddress, line.count) }
        // Close before the require, so a failed write leaks nothing; the read
        // then ends at EOF instead of waiting.
        close(fds[1])
        try #require(written == line.count)

        let read = RelayClient.readLine(fds[0], maxBytes: 16)

        #expect(read == (accepted ? line.dropLast() : nil))
    }
}
