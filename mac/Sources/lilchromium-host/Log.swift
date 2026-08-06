import Foundation
import LilShared

/// Tiny append-only logger with a 1MB truncation cap. Best-effort: logging must
/// never crash or block the relay, so all failures are swallowed.
final class HostLog {
    static let shared = HostLog()

    private let queue = DispatchQueue(label: "com.lilchromium.host.log")
    private let path: String
    private let maxBytes: Int = 1_000_000

    private init() {
        self.path = LilPaths.hostLogPath
    }

    func log(_ message: String) {
        queue.async { [path, maxBytes] in
            let stamp = ISO8601DateFormatter().string(from: Date())
            let line = "[\(stamp)] \(message)\n"
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
