import Foundation
import LilShared

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// Blocking unix-socket CLIENT for the app side. One short-lived connection per
/// request: connect, write a line, optionally read one reply line, close.
///
/// All methods are synchronous and intended to be called off the main thread.
/// A connect timeout keeps the UI responsive when the relay is down.
enum RelayClient {

    enum RelayError: Error {
        case socketCreateFailed
        case connectFailed
        case connectTimeout
        case writeFailed
        case readTimeout
        case decodeFailed
    }

    /// The routing order for sockets, per PROTOCOL.md "App routing order":
    /// 1. relay-<defaultBrowser>.sock  2. relay-<fallbackBrowser>.sock
    /// 3. any other relay-*.sock present (newest mtime first).
    /// Deduped, preserving order. Reads config fresh each call.
    private static func routedSockets() -> [(slug: String, path: String)] {
        let cfg = LilConfig.load()
        var order: [String] = [cfg.defaultBrowser, cfg.fallbackBrowser]
        // Append every present socket's slug (newest first) for step 3.
        for entry in LilPaths.allSocketURLs() where !order.contains(entry.slug) {
            order.append(entry.slug)
        }
        // Dedupe while preserving order (default/fallback may coincide).
        var seen = Set<String>()
        var result: [(slug: String, path: String)] = []
        for slug in order where !slug.isEmpty && !seen.contains(slug) {
            seen.insert(slug)
            result.append((slug: slug, path: LilPaths.socketPath(forBrowser: slug)))
        }
        return result
    }

    /// Connect to the relay socket at `path` with a millisecond connect timeout.
    /// Returns a connected fd on success. Caller must close it.
    private static func connect(path: String, timeoutMs: Int) throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        if fd < 0 { throw RelayError.socketCreateFailed }

        guard var addr = UnixSocket.makeAddress(path: path) else {
            Darwin.close(fd)
            throw RelayError.connectFailed
        }

        // Non-blocking connect + poll() for the timeout, then restore blocking.
        let flags = fcntl(fd, F_GETFL, 0)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

        let rc = UnixSocket.withSockaddr(&addr) { sp, size in
            Darwin.connect(fd, sp, size)
        }

        if rc != 0 {
            if errno != EINPROGRESS {
                Darwin.close(fd)
                throw RelayError.connectFailed
            }
            // Wait for writability (connect completion) up to the timeout using
            // poll() — Swift does not import the FD_SET macros cleanly, and
            // poll() sidesteps the whole fd_set tuple problem entirely.
            var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
            var polled: Int32 = -1
            repeat {
                polled = poll(&pfd, 1, Int32(timeoutMs))
            } while polled < 0 && errno == EINTR
            if polled <= 0 {
                Darwin.close(fd)
                throw RelayError.connectTimeout
            }
            // Check SO_ERROR to confirm the connect actually succeeded.
            var soErr: Int32 = 0
            var len = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &soErr, &len)
            if soErr != 0 {
                Darwin.close(fd)
                throw RelayError.connectFailed
            }
        }

        // Restore blocking mode for straightforward read/write with SO_*TIMEO.
        _ = fcntl(fd, F_SETFL, flags)
        // Apply read/write timeouts so a wedged relay never hangs the caller.
        var rtv = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &rtv, socklen_t(MemoryLayout<timeval>.size))
        var stv = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &stv, socklen_t(MemoryLayout<timeval>.size))
        return fd
    }

    private static func writeAll(_ fd: Int32, _ data: Data) -> Bool {
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
            guard let base = raw.baseAddress else { return true }
            var total = 0
            while total < data.count {
                let n = write(fd, base.advanced(by: total), data.count - total)
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

    /// Read one newline-delimited line (up to a hard cap). Returns nil on EOF or
    /// timeout without a complete line.
    private static func readLine(_ fd: Int32, maxBytes: Int = 8 * 1024 * 1024) -> Data? {
        let lineBuffer = LineBuffer()
        var buf = [UInt8](repeating: 0, count: 65536)
        var readSoFar = 0
        while readSoFar < maxBytes {
            let n = read(fd, &buf, buf.count)
            if n == 0 { return nil }
            if n < 0 {
                if errno == EINTR { continue }
                return nil // includes EAGAIN on RCVTIMEO expiry
            }
            readSoFar += n
            let lines = lineBuffer.append(Data(buf[0..<n]))
            if let first = lines.first { return first }
        }
        return nil
    }

    // MARK: - Public operations

    /// The browser slug that served the last successful routed request. Best
    /// effort, for optional caller diagnostics; not required by the palette.
    /// Guarded by a lock since requests run off the main thread.
    private static var lastServedBacking: String?
    private static let lastServedLock = NSLock()
    static var lastServedBrowser: String? {
        lastServedLock.lock(); defer { lastServedLock.unlock() }
        return lastServedBacking
    }
    private static func setLastServed(_ slug: String?) {
        lastServedLock.lock(); lastServedBacking = slug; lastServedLock.unlock()
    }

    /// Fire-and-forget send of an `open` message. Tries each routed socket in
    /// order (default, fallback, other live hosts newest-first); throws only if
    /// every socket fails so the caller can fall back to launching a browser.
    /// `incognito` (palette ⌘-Enter) sets `open.incognito` on the wire; the
    /// extension decides how to honor it (gated on isAllowedIncognitoAccess).
    static func sendOpen(url: String, left: Int, top: Int, incognito: Bool = false, connectTimeoutMs: Int = 300) throws {
        let line = try LilCodec.encodeLine(
            OpenMessage(url: url, left: left, top: top, incognito: incognito ? true : nil)
        )
        var lastError: Error = RelayError.connectFailed
        for target in routedSockets() {
            do {
                let fd = try connect(path: target.path, timeoutMs: connectTimeoutMs)
                defer { Darwin.close(fd) }
                if !writeAll(fd, line) { throw RelayError.writeFailed }
                setLastServed(target.slug)
                return
            } catch {
                lastError = error
                continue
            }
        }
        throw lastError
    }

    /// Ping the first reachable relay in routing order; returns
    /// extensionConnected. Throws if no relay answers.
    static func ping(connectTimeoutMs: Int = 300) throws -> Bool {
        var lastError: Error = RelayError.connectFailed
        for target in routedSockets() {
            do {
                let fd = try connect(path: target.path, timeoutMs: connectTimeoutMs)
                defer { Darwin.close(fd) }
                let id = UUID().uuidString
                let line = try LilCodec.encodeLine(PingMessage(id: id))
                if !writeAll(fd, line) { throw RelayError.writeFailed }
                guard let reply = readLine(fd),
                      let pong = try? LilCodec.decodeLine(PongMessage.self, from: reply) else {
                    throw RelayError.readTimeout
                }
                setLastServed(target.slug)
                return pong.extensionConnected
            } catch {
                lastError = error
                continue
            }
        }
        throw lastError
    }

    /// Send a history-query and wait for the matching result. Tries routed
    /// sockets in order (steps 1–3, no browser launch); returns the first
    /// non-throwing reply, or an empty array if no socket answers.
    static func historyQuery(text: String, maxResults: Int, connectTimeoutMs: Int = 500) throws -> [HistoryItem] {
        for target in routedSockets() {
            do {
                let fd = try connect(path: target.path, timeoutMs: connectTimeoutMs)
                defer { Darwin.close(fd) }
                let id = UUID().uuidString
                let line = try LilCodec.encodeLine(
                    HistoryQueryMessage(id: id, text: text, maxResults: maxResults)
                )
                if !writeAll(fd, line) { throw RelayError.writeFailed }
                guard let reply = readLine(fd),
                      let result = try? LilCodec.decodeLine(HistoryResultMessage.self, from: reply) else {
                    throw RelayError.readTimeout
                }
                setLastServed(target.slug)
                return result.items
            } catch {
                continue
            }
        }
        // No socket answered — empty result (PROTOCOL.md history-query).
        return []
    }
}
