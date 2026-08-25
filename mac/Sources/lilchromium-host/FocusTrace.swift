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
        case let .externalApp(pid, bundleId): return "external-app:pid=\(pid),bundleId=\(bundleId ?? "-")"
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
