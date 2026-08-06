import Foundation

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// Chrome native-messaging stdio transport.
///
/// Framing (per Chrome's spec): a 4-byte length prefix in **native** byte order
/// (UInt32), followed by that many bytes of UTF-8 JSON. We read from fd 0 and
/// write to fd 1 with raw POSIX read/write to avoid Foundation pipe buffering
/// surprises.
final class NativeMessaging {

    /// Called on the read thread for each complete inbound message (JSON bytes).
    var onMessage: ((Data) -> Void)?
    /// Called on the read thread when stdin reaches EOF (Chrome closed the port)
    /// or an unrecoverable read error occurs.
    var onEOF: (() -> Void)?

    private let readQueue = DispatchQueue(label: "com.lilchromium.host.stdin")
    // Serialize writes to stdout so concurrent forwards never interleave.
    private let writeLock = NSLock()
    private var stopped = false

    // Reject absurd frame sizes to avoid unbounded allocation on a corrupt pipe.
    private let maxFrameBytes: UInt32 = 64 * 1024 * 1024 // 64 MB

    func start() {
        readQueue.async { [weak self] in
            self?.readLoop()
        }
    }

    // MARK: - Reading

    private func readLoop() {
        while true {
            guard let lengthData = readExactly(4) else {
                // EOF or error on the length prefix.
                signalEOF()
                return
            }
            let length: UInt32 = lengthData.withUnsafeBytes { raw in
                raw.loadUnaligned(as: UInt32.self)
            }
            if length == 0 {
                continue
            }
            if length > maxFrameBytes {
                hlog("native: frame too large (\(length)); treating as EOF")
                signalEOF()
                return
            }
            guard let payload = readExactly(Int(length)) else {
                signalEOF()
                return
            }
            onMessage?(payload)
        }
    }

    /// Read exactly `count` bytes from stdin (fd 0), looping over partial reads.
    /// Returns nil on EOF (0-byte read) or a hard error.
    private func readExactly(_ count: Int) -> Data? {
        var buffer = Data(count: count)
        var total = 0
        let ok: Bool = buffer.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) -> Bool in
            guard let base = raw.baseAddress else { return false }
            while total < count {
                let n = read(0, base.advanced(by: total), count - total)
                if n == 0 {
                    return false // EOF
                }
                if n < 0 {
                    if errno == EINTR { continue }
                    return false // hard error
                }
                total += n
            }
            return true
        }
        return ok ? buffer : nil
    }

    // MARK: - Writing

    /// Write one framed message to stdout. Returns false if the write fails
    /// (e.g. Chrome closed the pipe) so the caller can exit.
    @discardableResult
    func send(_ json: Data) -> Bool {
        writeLock.lock()
        defer { writeLock.unlock() }

        var length = UInt32(json.count) // native byte order, as Chrome expects
        let header = withUnsafeBytes(of: &length) { Data($0) }

        if !writeAll(header) { return false }
        if !writeAll(json) { return false }
        return true
    }

    private func writeAll(_ data: Data) -> Bool {
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
            guard let base = raw.baseAddress else { return true }
            var total = 0
            let count = data.count
            while total < count {
                let n = write(1, base.advanced(by: total), count - total)
                if n < 0 {
                    if errno == EINTR { continue }
                    return false
                }
                if n == 0 { return false }
                total += n
            }
            return true
        }
    }

    private func signalEOF() {
        if stopped { return }
        stopped = true
        onEOF?()
    }
}
