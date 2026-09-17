import Foundation

/// LILFOCUS — the private diagnostic control of issue #30's real-Mac focus loop
/// (docs/PROTOCOL.md, "Private diagnostic control").
///
/// `scripts/focus-loop.mjs` writes it to a relay socket, the host validates it
/// here and forwards only the lines it can vouch for, and
/// `extension/focus-trace.js` executes it. It is not product behavior: neither
/// the app nor the host ever sends it, and the extension ignores every
/// operation until a run has armed the seam.
///
/// Cleanup check: `node scripts/focus-loop.mjs cleanup`.
public struct FocusTraceControlMessage: Decodable, Sendable {

    /// One explicitly tagged operation carrying only its own payload.
    public enum Operation: Equatable, Sendable {
        /// Begin a run. The collector endpoint is *derived* by the extension
        /// from these two values — loopback, this port, this run's path — so a
        /// control line can never redirect the trace stream.
        case arm(runId: String, port: Int, ttlMs: Int?)
        case disarm
        case snapshot(label: String)
        /// Tear down one lil the named run opened. Never a measurement.
        case closeLil(runId: String, windowId: Int)
    }

    public let type: String

    /// `nil` when the line names no operation this contract defines, or carries
    /// a payload the host cannot vouch for. Those lines are dropped, never
    /// forwarded.
    public let operation: Operation?

    private enum CodingKeys: String, CodingKey {
        case type, op, runId, port, ttlMs, label, windowId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.type = (try? c.decode(String.self, forKey: .type)) ?? MessageType.lilFocusTrace.rawValue
        self.operation = Self.operation(from: c)
    }

    private static func operation(from c: KeyedDecodingContainer<CodingKeys>) -> Operation? {
        let runId = (try? c.decode(String.self, forKey: .runId)).flatMap { isRunId($0) ? $0 : nil }

        switch try? c.decode(String.self, forKey: .op) {
        case "arm":
            guard let runId, let port = try? c.decode(Int.self, forKey: .port), (1...65535).contains(port) else {
                return nil
            }
            return .arm(runId: runId, port: port, ttlMs: try? c.decode(Int.self, forKey: .ttlMs))
        case "disarm":
            return .disarm
        case "snapshot":
            guard let label = try? c.decode(String.self, forKey: .label), !label.isEmpty else { return nil }
            return .snapshot(label: label)
        case "close-lil":
            guard let runId, let windowId = try? c.decode(Int.self, forKey: .windowId) else { return nil }
            return .closeLil(runId: runId, windowId: windowId)
        default:
            return nil
        }
    }

    /// A run id becomes a path segment of the extension's derived collector URL,
    /// so it is restricted to characters that cannot leave that segment.
    static func isRunId(_ value: String) -> Bool {
        (1...64).contains(value.count)
            && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) }
    }
}
