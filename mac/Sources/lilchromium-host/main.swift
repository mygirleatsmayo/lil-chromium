import Foundation
import LilShared

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

// lilchromium-host — native messaging host + unix-socket relay.
//
// Lifecycle: launched by Chrome when the extension calls connectNative(). Lives
// only while Chrome holds the stdio port open. On stdin EOF it exits cleanly and
// removes the socket. See docs/PROTOCOL.md for the wire contract.
//
// Routing:
//   socket "open"          -> forward to extension (stdout); queue if the write
//                             fails during the startup grace, else exit.
//   socket "history-query" -> forward to extension; remember the requesting
//                             connection by id so the matching history-result
//                             can be routed back to it.
//   socket "ping"          -> answer directly with pong (extensionConnected:true
//                             while this process lives).
//   stdin "history-result" -> route to the connection that issued the query.
//   unknown from socket     -> forward to extension.
//   unknown from extension  -> drop.

final class Relay {
    private let native = NativeMessaging()

    // The browser that launched us (detected at startup) and the socket path
    // we bind for it.
    private let browserSlug: String
    private let socketPath: String
    private let server: SocketServer

    init() {
        let slug = BrowserDetect.detectParentBrowser()
        self.browserSlug = slug
        self.socketPath = LilPaths.socketPath(forBrowser: slug)
        self.server = SocketServer(path: self.socketPath)
        // Route logging to host-<slug>.log as early as possible.
        HostLog.shared.configure(slug: slug)
    }

    // Map: history-query id -> the socket connection awaiting its result.
    private var pendingHistory: [String: SocketConnection] = [:]
    private let pendingLock = NSLock()

    // Queue of open messages awaiting a healthy stdout (max 20, FIFO, drop
    // oldest). In practice the extension port is up whenever this process is
    // alive, so this only buffers across the brief startup grace window.
    private var openQueue: [OpenMessage] = []
    private let queueLock = NSLock()
    private let maxQueue = 20

    // The extension port (stdout) is considered up for the life of the process.
    // Accessed from both the socket thread and native-messaging threads, so it
    // is guarded by a lock (only ever transitions true -> false).
    private var extensionUpBacking = true
    private let extensionUpLock = NSLock()
    private var extensionUp: Bool {
        get { extensionUpLock.lock(); defer { extensionUpLock.unlock() }; return extensionUpBacking }
        set { extensionUpLock.lock(); extensionUpBacking = newValue; extensionUpLock.unlock() }
    }

    func run() {
        LilPaths.ensureStateDir()
        hlog("host: starting (pid \(getpid())) browser=\(browserSlug) socket=\(socketPath)")

        // 1) Bind the socket first so we can detect another live host.
        let bind = server.bindAndListen()
        if !bind.ok {
            if bind.otherLiveHost {
                exit(0) // another host already owns the socket
            }
            hlog("host: could not bind socket; exiting")
            exit(1)
        }

        // 2) Wire the socket -> relay handler.
        server.onLine = { [weak self] line, conn in
            self?.handleSocketLine(line, from: conn)
        }
        server.start()

        // 3) Wire native messaging (extension) -> relay handler.
        native.onMessage = { [weak self] data in
            self?.handleExtensionMessage(data)
        }
        native.onEOF = { [weak self] in
            self?.shutdown(reason: "stdin EOF (Chrome closed port)")
        }
        native.start()

        // 4) Park the main thread on the run loop; work happens on worker
        //    threads and calls exit() directly on shutdown.
        RunLoop.main.run()
    }

    // MARK: - Socket -> relay

    private func handleSocketLine(_ line: Data, from conn: SocketConnection) {
        guard let env = try? LilCodec.decodeLine(LilMessage.self, from: line) else {
            hlog("socket: undecodable line dropped")
            return
        }

        switch env.type {
        case MessageType.ping.rawValue:
            let id = env.id ?? ""
            if let reply = try? LilCodec.encodeLine(
                PongMessage(id: id, extensionConnected: extensionUp, browser: browserSlug)
            ) {
                conn.writeLine(reply)
            }
            // Ping is a short probe; the app closes right after. Leave the
            // connection for the peer to close.

        case MessageType.historyQuery.rawValue:
            let id = env.id ?? UUID().uuidString
            if !extensionUp {
                // Reply immediately with empty items (PROTOCOL.md).
                if let reply = try? LilCodec.encodeLine(
                    HistoryResultMessage(id: id, items: [])
                ) {
                    conn.writeLine(reply)
                }
                return
            }
            pendingLock.lock()
            pendingHistory[id] = conn
            pendingLock.unlock()
            forwardToExtension(line, kind: "history-query")

        case MessageType.open.rawValue:
            if extensionUp {
                if !forwardToExtension(line, kind: "open") {
                    enqueueOpen(line)
                }
            } else {
                enqueueOpen(line)
            }

        default:
            // Unknown from socket -> forward to extension verbatim.
            forwardToExtension(line, kind: "unknown(\(env.type))")
        }
    }

    /// Enqueue an open message (decoded from a raw line) for later flush.
    private func enqueueOpen(_ line: Data) {
        guard let msg = try? LilCodec.decodeLine(OpenMessage.self, from: line) else { return }
        queueLock.lock()
        openQueue.append(msg)
        if openQueue.count > maxQueue {
            openQueue.removeFirst(openQueue.count - maxQueue) // drop oldest
        }
        queueLock.unlock()
        hlog("host: queued open (\(msg.url)); depth \(openQueue.count)")
    }

    /// Forward a raw newline-delimited line to the extension as a native message
    /// (strip the trailing newline; native messaging carries no newline). If the
    /// write fails, the port is gone -> shut down.
    @discardableResult
    private func forwardToExtension(_ line: Data, kind: String) -> Bool {
        var payload = line
        if payload.last == 0x0A { payload.removeLast() }
        let ok = native.send(payload)
        if !ok {
            hlog("host: stdout write failed on \(kind)")
            extensionUp = false
        }
        return ok
    }

    // MARK: - Extension -> relay

    private func handleExtensionMessage(_ data: Data) {
        guard let env = try? LilCodec.decode(LilMessage.self, from: data) else {
            hlog("extension: undecodable message dropped")
            return
        }

        switch env.type {
        case MessageType.historyResult.rawValue:
            guard let id = env.id else {
                hlog("extension: history-result without id dropped")
                return
            }
            pendingLock.lock()
            let conn = pendingHistory.removeValue(forKey: id)
            pendingLock.unlock()

            guard let conn = conn else {
                hlog("extension: history-result for unknown id \(id) dropped")
                return
            }
            var line = data
            line.append(0x0A)
            conn.writeLine(line)
            // The app closes after receiving; we leave close to the peer.

        case MessageType.getContext.rawValue:
            // Read config fresh and reply on the port with the runtime context.
            handleGetContext(id: env.id ?? "")

        case MessageType.openExternal.rawValue:
            handleOpenExternal(data)

        default:
            // Unknown from extension -> drop (per PROTOCOL.md).
            hlog("extension: dropping unforwarded type \(env.type)")
        }
    }

    // MARK: - get-context / open-external (v2)

    /// Build a `context` reply from a fresh config read + our detected identity
    /// and send it back on the extension port.
    private func handleGetContext(id: String) {
        let cfg = LilConfig.load()

        // Prefer a name from the config's knownBrowsers, fall back to the table.
        func displayName(forSlug slug: String) -> String {
            if let kb = cfg.knownBrowsers.first(where: { $0.slug == slug }), !kb.name.isEmpty {
                return kb.name
            }
            return BrowserTable.name(forSlug: slug)
        }

        // Prefer config's knownBrowsers list; if empty (no scan yet) fall back
        // to the full table marked not-installed so the extension always has a
        // menu to build from.
        let known: [ContextBrowser]
        if cfg.knownBrowsers.isEmpty {
            known = BrowserTable.all.map {
                ContextBrowser(slug: $0.slug, name: $0.name, installed: false)
            }
        } else {
            known = cfg.knownBrowsers.map {
                ContextBrowser(slug: $0.slug, name: $0.name, installed: $0.installed)
            }
        }

        let ctx = ContextMessage(
            id: id,
            browser: browserSlug,
            browserName: BrowserTable.name(forSlug: browserSlug),
            defaultBrowser: cfg.defaultBrowser,
            defaultBrowserName: displayName(forSlug: cfg.defaultBrowser),
            fallbackBrowser: cfg.fallbackBrowser,
            linkBehavior: cfg.linkBehavior,
            knownBrowsers: known
        )

        guard let payload = try? LilCodec.encode(ctx) else {
            hlog("host: failed to encode context reply")
            return
        }
        if !native.send(payload) {
            hlog("host: stdout write failed on context")
            extensionUp = false
        }
    }

    /// Launch a URL in another browser via `/usr/bin/open -b <bundleId> <url>`.
    /// Validates the URL scheme (http/https only) and resolves the bundle id
    /// from the slug table. Fire-and-forget; failures are logged.
    private func handleOpenExternal(_ data: Data) {
        guard let msg = try? LilCodec.decode(OpenExternalMessage.self, from: data) else {
            hlog("host: undecodable open-external dropped")
            return
        }

        let lower = msg.url.lowercased()
        guard lower.hasPrefix("http://") || lower.hasPrefix("https://") else {
            hlog("host: open-external refused non-http(s) url")
            return
        }
        guard let bundleId = BrowserTable.bundleId(forSlug: msg.browser) else {
            hlog("host: open-external unknown browser slug \(msg.browser)")
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        proc.arguments = ["-b", bundleId, msg.url]
        do {
            try proc.run()
            hlog("host: open-external \(msg.browser) \(msg.url)")
        } catch {
            hlog("host: open-external launch failed: \(error)")
        }
    }

    // MARK: - Shutdown

    private func shutdown(reason: String) {
        hlog("host: shutting down: \(reason)")
        server.stop()
        // Remove the socket file explicitly (server.stop unlinks too — belt and
        // braces in case bind used a path that differs from a symlink target).
        unlink(socketPath)
        exit(0)
    }
}

// Entry point.
let relay = Relay()
relay.run()
