import AppKit
import LilShared

/// LILFOCUS — uniquely tagged host-side trace lines for issue #30's real-Mac
/// focus loop. `scripts/focus-loop.mjs` reads them out of
/// `~/.lilchromium/host-<slug>.log`, which is why every line carries the tag.
///
/// This is observation only: it reads public NSWorkspace state and writes to a
/// log the host already keeps. It never changes what the host does, and nothing
/// in the product reads it back.
///
/// Cleanup check: `node scripts/focus-loop.mjs cleanup`.
enum FocusTrace {
    static let tag = "LILFOCUS"

    /// How long to wait before reading the frontmost application back. macOS
    /// activation is asynchronous, so an immediate read reports the state
    /// before the request landed.
    private static let settleDelay: TimeInterval = 0.35

    /// One-line rendering of a prior context, stable enough to diff across runs.
    static func describe(_ priorContext: PriorContext) -> String {
        switch priorContext {
        case let .lil(windowId): return "lil:\(windowId)"
        case let .normalWindow(windowId): return "normal-window:\(windowId)"
        case let .externalApp(pid, bundleId):
            return "external-app:pid=\(pid.map(String.init) ?? "-"),bundleId=\(bundleId ?? "-")"
        }
    }

    /// The frontmost application after activation has had a chance to settle —
    /// the difference between "the host asked" and "macOS complied".
    @MainActor
    static func logFrontmostAfterSettling(label: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + settleDelay) {
            let app = NSWorkspace.shared.frontmostApplication
            hlog(
                "[\(tag)] frontmost-after label=\(label)"
                    + " pid=\(app.map { String($0.processIdentifier) } ?? "-")"
                    + " bundleId=\(app?.bundleIdentifier ?? "-")"
            )
        }
    }

    /// Validate one `lil-focus-trace` control line and forward only what this
    /// contract defines (see `FocusTraceControl.swift`). Every decision is
    /// logged under the tag, so a refused line is visible in the same trace the
    /// harness already reads.
    static func forwardControl(_ line: Data, forward: (Data) -> Void) {
        guard
            let msg = try? LilCodec.decodeLine(FocusTraceControlMessage.self, from: line),
            let operation = msg.operation
        else {
            hlog("[\(tag)] control dropped: not an operation this contract defines")
            return
        }
        hlog("[\(tag)] control \(describe(operation))")
        forward(line)
    }

    /// One-line rendering of a control operation. Never includes the collector
    /// endpoint, because there is none on the wire: the extension derives it.
    static func describe(_ operation: FocusTraceControlMessage.Operation) -> String {
        switch operation {
        case let .arm(runId, port, ttlMs):
            return "arm runId=\(runId) port=\(port) ttlMs=\(ttlMs.map(String.init) ?? "default")"
        case .disarm:
            return "disarm"
        case let .snapshot(label):
            return "snapshot label=\(label)"
        case let .closeLil(runId, windowId):
            return "close-lil runId=\(runId) windowId=\(windowId)"
        }
    }

    /// The `open` the app just handed us, including the external predecessor it
    /// captured before Chromium could change focus.
    static func logOpen(_ line: Data) {
        guard let msg = try? LilCodec.decodeLine(OpenMessage.self, from: line) else { return }
        hlog(
            "[\(tag)] open url=\(msg.url) left=\(msg.left) top=\(msg.top)"
                + " incognito=\(msg.incognito ?? false)"
                + " appPriorContext=\(msg.priorContext.map(describe) ?? "none")"
        )
    }
}
