import Foundation

/// JSON encode/decode helpers shared by the app and host.
///
/// The app<->host transport is newline-delimited JSON (one compact object per
/// line, no pretty-printing). These helpers keep that contract in one place.
public enum LilCodec {

    /// A single encoder configured to emit compact JSON with no stray newlines.
    /// (JSONEncoder never inserts newlines unless `.prettyPrinted` is set, so
    /// the encoded bytes are safe to frame with a trailing '\n'.)
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        // Deterministic key order helps logging/debugging; harmless on the wire.
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }

    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }

    /// Encode `value` as a single newline-terminated JSON line (UTF-8).
    public static func encodeLine<T: Encodable>(_ value: T) throws -> Data {
        var data = try encode(value)
        data.append(0x0A) // '\n'
        return data
    }

    /// Decode one JSON line (a trailing newline, if present, is tolerated).
    public static func decodeLine<T: Decodable>(_ type: T.Type, from line: Data) throws -> T {
        var slice = line
        if slice.last == 0x0A { slice.removeLast() }
        return try decode(type, from: slice)
    }
}

/// Accumulates bytes from a stream and yields complete newline-delimited lines.
/// Robust to partial reads: a line split across two reads is buffered until the
/// terminating '\n' arrives.
public final class LineBuffer {
    private var buffer = Data()

    public init() {}

    /// Append newly read bytes and return every complete line contained so far.
    /// The trailing partial line (no newline yet) stays buffered.
    public func append(_ data: Data) -> [Data] {
        buffer.append(data)
        var lines: [Data] = []
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer.subdata(in: buffer.startIndex..<nl)
            lines.append(line)
            // Advance past the newline.
            buffer.removeSubrange(buffer.startIndex...nl)
        }
        return lines
    }

    /// Any bytes buffered after the last newline (used at EOF if a caller wants
    /// to attempt a final unterminated line — normally ignored).
    public var pending: Data { buffer }
}
