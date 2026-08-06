import Foundation
import LilShared

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// A live socket connection. Newline-delimited JSON, short-lived. Each accepted
/// connection is serviced on its own thread; writes are guarded by a lock so
/// the relay can push a delayed reply (e.g. a history-result) from another
/// thread.
final class SocketConnection {
    let fd: Int32
    let id: UInt64
    private let writeLock = NSLock()
    private var closed = false

    init(fd: Int32, id: UInt64) {
        self.fd = fd
        self.id = id
    }

    /// Write a newline-terminated JSON line. Returns false if the peer is gone.
    @discardableResult
    func writeLine(_ data: Data) -> Bool {
        writeLock.lock()
        defer { writeLock.unlock() }
        if closed { return false }
        return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
            guard let base = raw.baseAddress else { return true }
            var total = 0
            let count = data.count
            while total < count {
                let n = write(fd, base.advanced(by: total), count - total)
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

    func close() {
        writeLock.lock()
        defer { writeLock.unlock() }
        if closed { return }
        closed = true
        _ = Darwin.close(fd)
    }
}

/// POSIX unix-domain-socket SERVER. Binds ~/.lilchromium/relay.sock, accepts
/// connections on a background thread, and services each on its own thread.
final class SocketServer {
    private let path: String
    private var listenFd: Int32 = -1
    private let acceptQueue = DispatchQueue(label: "com.lilchromium.host.accept")
    private var nextConnID: UInt64 = 1
    private let connIDLock = NSLock()

    /// Called (on a connection thread) for each complete inbound line, with the
    /// connection it arrived on so replies can be routed back.
    var onLine: ((Data, SocketConnection) -> Void)?

    init(path: String) {
        self.path = path
    }

    // MARK: - Bind with stale-socket handling

    /// Bind the socket, handling a stale/leftover file per PROTOCOL.md:
    /// on EADDRINUSE, try to connect and ping; if a live host answers pong the
    /// new host must exit(0); otherwise unlink the stale file and rebind.
    /// Returns true on success. Returns false with `otherLiveHost == true` when
    /// another live host owns the socket.
    func bindAndListen() -> (ok: Bool, otherLiveHost: Bool) {
        // First attempt.
        if tryBind() { return (true, false) }

        // Bind failed. If the path is in use, probe for a live host.
        if errno == EADDRINUSE || FileManager.default.fileExists(atPath: path) {
            if probeLiveHost() {
                hlog("socket: another live host answered ping; exiting")
                return (false, true)
            }
            // Stale socket: remove and retry.
            hlog("socket: removing stale socket at \(path)")
            unlink(path)
            if tryBind() { return (true, false) }
        }

        hlog("socket: bind failed (errno \(errno))")
        return (false, false)
    }

    private func tryBind() -> Bool {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        if fd < 0 {
            hlog("socket: socket() failed errno \(errno)")
            return false
        }

        guard var addr = UnixSocket.makeAddress(path: path) else {
            hlog("socket: path too long")
            Darwin.close(fd)
            return false
        }

        let bindResult = UnixSocket.withSockaddr(&addr) { sp, size in
            Darwin.bind(fd, sp, size)
        }
        if bindResult != 0 {
            // Leave errno intact for the caller to inspect (EADDRINUSE etc.).
            Darwin.close(fd)
            return false
        }

        if listen(fd, 16) != 0 {
            hlog("socket: listen() failed errno \(errno)")
            Darwin.close(fd)
            return false
        }

        // Restrict the socket file to the current user.
        chmod(path, 0o600)
        listenFd = fd
        return true
    }

    /// Connect to an existing socket and send a ping; return true if a pong
    /// comes back (meaning a live host owns it).
    private func probeLiveHost() -> Bool {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        if fd < 0 { return false }
        defer { Darwin.close(fd) }

        guard var addr = UnixSocket.makeAddress(path: path) else { return false }

        // Best-effort short timeout so a dead-but-present socket does not hang.
        var tv = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        let connectResult = UnixSocket.withSockaddr(&addr) { sp, size in
            Darwin.connect(fd, sp, size)
        }
        if connectResult != 0 { return false } // nobody listening -> stale

        guard let line = try? LilCodec.encodeLine(PingMessage(id: "probe")) else { return false }
        let sent = line.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
            guard let base = raw.baseAddress else { return false }
            var total = 0
            while total < line.count {
                let n = write(fd, base.advanced(by: total), line.count - total)
                if n <= 0 { return false }
                total += n
            }
            return true
        }
        if !sent { return false }

        // Read a small reply and look for a pong.
        var buf = [UInt8](repeating: 0, count: 512)
        let n = read(fd, &buf, buf.count)
        if n <= 0 { return false }
        let data = Data(buf[0..<n])
        if let env = try? LilCodec.decodeLine(LilMessage.self, from: data),
           env.type == MessageType.pong.rawValue {
            return true
        }
        return false
    }

    // MARK: - Accept loop

    func start() {
        acceptQueue.async { [weak self] in
            self?.acceptLoop()
        }
    }

    private func acceptLoop() {
        while listenFd >= 0 {
            let clientFd = accept(listenFd, nil, nil)
            if clientFd < 0 {
                if errno == EINTR { continue }
                if errno == EBADF || errno == EINVAL {
                    return // listener closed during shutdown
                }
                continue
            }
            connIDLock.lock()
            let cid = nextConnID
            nextConnID += 1
            connIDLock.unlock()

            let conn = SocketConnection(fd: clientFd, id: cid)
            Thread.detachNewThread { [weak self] in
                self?.serve(conn)
            }
        }
    }

    private func serve(_ conn: SocketConnection) {
        let lineBuffer = LineBuffer()
        var buf = [UInt8](repeating: 0, count: 8192)
        while true {
            let n = read(conn.fd, &buf, buf.count)
            if n == 0 { break }        // peer closed
            if n < 0 {
                if errno == EINTR { continue }
                break
            }
            let chunk = Data(buf[0..<n])
            for line in lineBuffer.append(chunk) {
                if line.isEmpty { continue }
                onLine?(line, conn)
            }
        }
        conn.close()
    }

    // MARK: - Shutdown

    func stop() {
        if listenFd >= 0 {
            let fd = listenFd
            listenFd = -1
            Darwin.close(fd)
        }
        unlink(path)
    }
}
