import Foundation
import LilShared

/// Tiny append-only logger with a 1MB truncation cap. Best-effort: logging must
/// never crash or block the relay, so all failures are swallowed.
final class HostLog {
    static let shared = HostLog()

    private let queue = DispatchQueue(label: "com.lilchromium.host.log")
    // The log path depends on the detected browser slug, which is known only
    // after startup. It is set once via configure(slug:) before heavy logging.
    // Guarded by the log queue so reads/writes never race.
    private var path: String

    private let maxBytes: Int = 1_000_000

    // Millisecond stamps: `[LILFOCUS] restore-focus` lines are read against
    // the extension trace's `t`, a millisecond epoch (issue #31 evidence).
    private static let stampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// The timestamp a log line opens with: `2026-09-17T23:30:13.417Z`.
    static func stamp(_ date: Date) -> String {
        stampFormatter.string(from: date)
    }

    private init() {
        // Fallback until the slug is known (pre-detection startup lines).
        self.path = LilPaths.hostLogPath(forBrowser: "unknown")
    }

    /// Point the log at `host-<slug>.log`. Serialized on the log queue so it
    /// applies before any subsequently-enqueued log lines are written.
    func configure(slug: String) {
        queue.async { [weak self] in
            self?.path = LilPaths.hostLogPath(forBrowser: slug)
        }
    }

    func log(_ message: String) {
        queue.async { [maxBytes] in
            let path = self.path
            let line = "[\(HostLog.stamp(Date()))] \(message)\n"
            guard let data = line.data(using: .utf8) else { return }

            let fm = FileManager.default
            // Truncate if the file has grown past the cap.
            if let attrs = try? fm.attributesOfItem(atPath: path),
               let size = attrs[.size] as? Int, size > maxBytes {
                try? Data().write(to: URL(fileURLWithPath: path))
            }

            if let handle = FileHandle(forWritingAtPath: path) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: data)
            } else {
                // File does not exist yet — create it.
                try? data.write(to: URL(fileURLWithPath: path))
            }
        }
    }
}

@inline(__always)
func hlog(_ message: String) {
    HostLog.shared.log(message)
}
