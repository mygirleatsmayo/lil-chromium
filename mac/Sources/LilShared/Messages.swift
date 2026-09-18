import Foundation

// Wire messages. These mirror docs/PROTOCOL.md exactly. All are JSON objects
// with a `type` field; `id` is a caller-generated string for req/resp matching.
//
// We model each message as its own Codable struct rather than one big enum so
// that field presence matches the protocol precisely and encoding never emits
// unexpected keys. `LilMessage` is a light envelope used for routing decisions
// (it only decodes `type` and `id`).

public enum MessageType: String, Codable, Sendable {
    case open
    case historyQuery = "history-query"
    case historyResult = "history-result"
    case ping
    case pong
    // v2: extension <-> host direct messages (never forwarded to the app).
    case getContext = "get-context"
    case context
    case openExternal = "open-external"
    case restoreFocus = "restore-focus"
    // v3: extension -> host, edits sleep.whitelist in config.json.
    case whitelistOp = "whitelist-op"
    // v4: extension -> host, open native Settings (never forwarded).
    case openSettings = "open-settings"
    // v4 (issue #12): app -> every relay -> extension, hot-applied Settings write.
    case configUpdate = "config-update"
    // LILFOCUS (issue #30): private diagnostic control, harness -> relay ->
    // extension. Never sent by the app or the host; see FocusTraceControl.swift.
    case lilFocusTrace = "lil-focus-trace"
}

/// The context that was active before one lil took focus (ADR-0004). Browser
/// window identities are meaningful only to the extension instance that
/// recorded them. An external application recorded by the app at open time
/// carries its exact process id plus an optional bundle-id fallback; one the
/// user came back to the browser from carries neither, and the host resolves
/// it from its own activation history.
public enum PriorContext: Codable, Equatable, Sendable {
    case lil(windowId: Int)
    case normalWindow(windowId: Int)
    case externalApp(pid: Int32?, bundleId: String?)

    private enum Kind: String, Codable {
        case lil
        case normalWindow = "normal-window"
        case externalApp = "external-app"
    }

    private enum CodingKeys: String, CodingKey {
        case kind, windowId, pid, bundleId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .lil:
            self = .lil(windowId: try container.decode(Int.self, forKey: .windowId))
        case .normalWindow:
            self = .normalWindow(windowId: try container.decode(Int.self, forKey: .windowId))
        case .externalApp:
            self = .externalApp(
                pid: try container.decodeIfPresent(Int32.self, forKey: .pid),
                bundleId: try container.decodeIfPresent(String.self, forKey: .bundleId)
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .lil(windowId):
            try container.encode(Kind.lil, forKey: .kind)
            try container.encode(windowId, forKey: .windowId)
        case let .normalWindow(windowId):
            try container.encode(Kind.normalWindow, forKey: .kind)
            try container.encode(windowId, forKey: .windowId)
        case let .externalApp(pid, bundleId):
            try container.encode(Kind.externalApp, forKey: .kind)
            try container.encodeIfPresent(pid, forKey: .pid)
            try container.encodeIfPresent(bundleId, forKey: .bundleId)
        }
    }
}

/// Minimal envelope: decode just enough to route/dispatch, ignore the rest.
public struct LilMessage: Codable, Sendable {
    public let type: String
    public let id: String?

    public init(type: String, id: String? = nil) {
        self.type = type
        self.id = id
    }
}

/// app -> extension: open an ephemeral window.
/// `left`/`top` are the suggested window top-left in Chrome screen coordinates
/// (top-left origin, points). The app performs the AppKit Y-flip before sending.
/// `incognito` (v3): true → open an incognito lil (palette ⌘-Enter). Omitted
/// from the wire when nil — never encoded as an explicit `null`.
public struct OpenMessage: Codable, Sendable {
    public let type: String
    public let url: String
    public let left: Int
    public let top: Int
    public let incognito: Bool?
    public let priorContext: PriorContext?

    // Explicit CodingKeys: both init(from:) and encode(to:) are custom, so we
    // declare the keys rather than depend on synthesis.
    private enum CodingKeys: String, CodingKey {
        case type, url, left, top, incognito, priorContext
    }

    public init(
        url: String,
        left: Int,
        top: Int,
        incognito: Bool? = nil,
        priorContext: PriorContext? = nil
    ) {
        self.type = MessageType.open.rawValue
        self.url = url
        self.left = left
        self.top = top
        self.incognito = incognito
        self.priorContext = priorContext
    }

    // Tolerate a v1/v2 open that lacks `incognito`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.type = (try? c.decode(String.self, forKey: .type)) ?? MessageType.open.rawValue
        self.url = try c.decode(String.self, forKey: .url)
        self.left = (try? c.decode(Int.self, forKey: .left)) ?? 0
        self.top = (try? c.decode(Int.self, forKey: .top)) ?? 0
        // decodeIfPresent -> Bool?; wrap in try? and flatten the Bool?? so a
        // decode error or a missing/null key both collapse to nil.
        self.incognito = (try? c.decodeIfPresent(Bool.self, forKey: .incognito)) ?? nil
        self.priorContext = try c.decodeIfPresent(PriorContext.self, forKey: .priorContext)
    }

    // Encode `incognito` only when present so we never emit `"incognito":null`.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(url, forKey: .url)
        try c.encode(left, forKey: .left)
        try c.encode(top, forKey: .top)
        try c.encodeIfPresent(incognito, forKey: .incognito)
        try c.encodeIfPresent(priorContext, forKey: .priorContext)
    }
}

/// extension -> host: restore an external app after its successor lil closes.
/// Browser-window predecessors are restored inside the extension and never
/// cross the native boundary.
public struct RestoreFocusMessage: Codable, Sendable {
    public let type: String
    public let priorContext: PriorContext

    public init(priorContext: PriorContext) {
        self.type = MessageType.restoreFocus.rawValue
        self.priorContext = priorContext
    }
}

/// app -> extension: ask the extension to search Chrome history.
public struct HistoryQueryMessage: Codable, Sendable {
    public let type: String
    public let id: String
    public let text: String
    public let maxResults: Int

    public init(id: String, text: String, maxResults: Int) {
        self.type = MessageType.historyQuery.rawValue
        self.id = id
        self.text = text
        self.maxResults = maxResults
    }
}

/// One history entry as returned by the extension.
public struct HistoryItem: Codable, Sendable, Equatable {
    public let url: String
    public let title: String
    public let lastVisitTime: Double
    public let visitCount: Int
    public let typedCount: Int

    public init(url: String, title: String, lastVisitTime: Double, visitCount: Int, typedCount: Int) {
        self.url = url
        self.title = title
        self.lastVisitTime = lastVisitTime
        self.visitCount = visitCount
        self.typedCount = typedCount
    }

    // Chrome may omit title/counts for some entries; be defensive so a single
    // odd row never fails the whole decode.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.url = try c.decode(String.self, forKey: .url)
        self.title = (try? c.decode(String.self, forKey: .title)) ?? ""
        self.lastVisitTime = (try? c.decode(Double.self, forKey: .lastVisitTime)) ?? 0
        self.visitCount = (try? c.decode(Int.self, forKey: .visitCount)) ?? 0
        self.typedCount = (try? c.decode(Int.self, forKey: .typedCount)) ?? 0
    }
}

/// extension -> app: reply to a history-query, matched by `id`.
public struct HistoryResultMessage: Codable, Sendable {
    public let type: String
    public let id: String
    public let items: [HistoryItem]

    public init(id: String, items: [HistoryItem]) {
        self.type = MessageType.historyResult.rawValue
        self.id = id
        self.items = items
    }
}

/// app -> host (never forwarded): liveness probe.
public struct PingMessage: Codable, Sendable {
    public let type: String
    public let id: String

    public init(id: String) {
        self.type = MessageType.ping.rawValue
        self.id = id
    }
}

/// host -> app: ping reply; `extensionConnected` drives the app's fallback.
/// v2: `browser` carries the host's detected browser slug.
public struct PongMessage: Codable, Sendable {
    public let type: String
    public let id: String
    public let extensionConnected: Bool
    public let browser: String

    public init(id: String, extensionConnected: Bool, browser: String = "unknown") {
        self.type = MessageType.pong.rawValue
        self.id = id
        self.extensionConnected = extensionConnected
        self.browser = browser
    }

    // Tolerate a v1 pong that lacks `browser`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.type = try c.decode(String.self, forKey: .type)
        self.id = try c.decode(String.self, forKey: .id)
        self.extensionConnected = (try? c.decode(Bool.self, forKey: .extensionConnected)) ?? false
        self.browser = (try? c.decode(String.self, forKey: .browser)) ?? "unknown"
    }
}

// MARK: - v2 extension <-> host direct messages

/// extension -> host: request the current runtime context. Host replies with
/// a `context` message on the same port. Host never forwards this to the app.
public struct GetContextMessage: Codable, Sendable {
    public let type: String
    public let id: String

    public init(id: String) {
        self.type = MessageType.getContext.rawValue
        self.id = id
    }
}

/// One browser entry as carried in a `context` reply (a trimmed KnownBrowser:
/// no bundleId, per PROTOCOL.md context schema).
public struct ContextBrowser: Codable, Sendable {
    public let slug: String
    public let name: String
    public let installed: Bool

    public init(slug: String, name: String, installed: Bool) {
        self.slug = slug
        self.name = name
        self.installed = installed
    }
}

/// host -> extension: the runtime context reply (matched by `id`). The host
/// injects its own detected identity (`browser`/`browserName`) and merges the
/// freshly-read config for the rest.
///
/// v3: the context now carries the FULL config objects verbatim from config.json
/// (`ephemeralDefault`, `sleep`, `searchEngine`, `hoverBar`) alongside the host's
/// browser identity. Sub-structs are the same Codable types LilConfig uses.
public struct ContextMessage: Codable, Sendable {
    public let type: String
    public let id: String
    public let browser: String
    public let browserName: String
    public let primaryBrowser: String
    public let primaryBrowserName: String
    public let fallbackBrowser: String
    public let linkBehavior: String
    public let ephemeralDefault: String
    public let sleep: SleepConfig
    public let searchEngine: SearchEngineConfig
    public let hoverBar: HoverBarConfig
    public let knownBrowsers: [ContextBrowser]

    public init(
        id: String,
        browser: String,
        browserName: String,
        primaryBrowser: String,
        primaryBrowserName: String,
        fallbackBrowser: String,
        linkBehavior: String,
        ephemeralDefault: String,
        sleep: SleepConfig,
        searchEngine: SearchEngineConfig,
        hoverBar: HoverBarConfig,
        knownBrowsers: [ContextBrowser]
    ) {
        self.type = MessageType.context.rawValue
        self.id = id
        self.browser = browser
        self.browserName = browserName
        self.primaryBrowser = primaryBrowser
        self.primaryBrowserName = primaryBrowserName
        self.fallbackBrowser = fallbackBrowser
        self.linkBehavior = linkBehavior
        self.ephemeralDefault = ephemeralDefault
        self.sleep = sleep
        self.searchEngine = searchEngine
        self.hoverBar = hoverBar
        self.knownBrowsers = knownBrowsers
    }

    /// Fresh-read reconnect reply: host identity plus the same ContextPayload
    /// mapping `config-update` uses, so the two wires cannot drift.
    public init(id: String, browser: String, config: LilConfig) {
        self.init(
            id: id,
            browser: browser,
            browserName: BrowserTable.name(forSlug: browser),
            primaryBrowser: config.primaryBrowser,
            primaryBrowserName: ContextPayload.displayName(forSlug: config.primaryBrowser, in: config),
            fallbackBrowser: config.fallbackBrowser,
            linkBehavior: config.linkBehavior,
            ephemeralDefault: config.ephemeralDefault,
            sleep: config.sleep,
            searchEngine: config.searchEngine,
            hoverBar: config.hoverBar,
            knownBrowsers: ContextPayload.browsers(from: config)
        )
    }
}

/// The config payload mapping shared by `context` (host -> its extension) and
/// `config-update` (app -> every relay -> every extension). One mapping so the
/// two messages can never diverge in shape or normalization (issue #12).
public enum ContextPayload {
    /// knownBrowsers in the trimmed wire shape (no bundle ids). An empty
    /// config list falls back to the full catalog marked not-installed, so
    /// the extension always has a menu to build from.
    public static func browsers(from config: LilConfig) -> [ContextBrowser] {
        if config.knownBrowsers.isEmpty {
            return BrowserTable.all.map {
                ContextBrowser(slug: $0.slug, name: $0.name, installed: false)
            }
        }
        return config.knownBrowsers.map {
            ContextBrowser(slug: $0.slug, name: $0.name, installed: $0.installed)
        }
    }

    /// Display name for a slug: the config's knownBrowsers first, then the
    /// catalog (which capitalizes unknown slugs so callers always get a name).
    public static func displayName(forSlug slug: String, in config: LilConfig) -> String {
        if let kb = config.knownBrowsers.first(where: { $0.slug == slug }), !kb.name.isEmpty {
            return kb.name
        }
        return BrowserTable.name(forSlug: slug)
    }
}

/// app -> every live relay -> extension (v4, issue #12): a native Settings
/// write published to ALL relays, not just the current routing target. The
/// payload is the normalized full configuration — the `context` config fields
/// minus the host identity (`browser`/`browserName`), which each service
/// worker keeps for itself when it replaces its cached context.
///
/// The host forwards the line verbatim and never queues it: a relay that
/// misses the broadcast catches up from config.json on the extension's next
/// (re)connect `get-context`, which the host always answers with a fresh read.
public struct ConfigUpdateMessage: Codable, Sendable {
    public let type: String
    public let primaryBrowser: String
    public let primaryBrowserName: String
    public let fallbackBrowser: String
    public let linkBehavior: String
    public let ephemeralDefault: String
    public let sleep: SleepConfig
    public let searchEngine: SearchEngineConfig
    public let hoverBar: HoverBarConfig
    public let knownBrowsers: [ContextBrowser]

    /// The broadcast for the config the app just persisted. Values arrive
    /// already normalized by the model (e.g. clamped `hoverBar.revealHeight`).
    public init(config: LilConfig) {
        self.type = MessageType.configUpdate.rawValue
        self.primaryBrowser = config.primaryBrowser
        self.primaryBrowserName = ContextPayload.displayName(forSlug: config.primaryBrowser, in: config)
        self.fallbackBrowser = config.fallbackBrowser
        self.linkBehavior = config.linkBehavior
        self.ephemeralDefault = config.ephemeralDefault
        self.sleep = config.sleep
        self.searchEngine = config.searchEngine
        self.hoverBar = config.hoverBar
        self.knownBrowsers = ContextPayload.browsers(from: config)
    }
}

/// extension -> host (never forwarded): add/remove a domain in
/// `sleep.whitelist` inside config.json. The host performs an atomic
/// read-modify-write that preserves every other field (see ConfigMerge).
public struct WhitelistOpMessage: Codable, Sendable {
    public let type: String
    public let op: String       // "add" | "remove"
    public let domain: String

    public init(op: String, domain: String) {
        self.type = MessageType.whitelistOp.rawValue
        self.op = op
        self.domain = domain
    }

    // Defensive decode: missing fields degrade to empty strings; the handler
    // then no-ops on an empty domain or unknown op.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.type = (try? c.decode(String.self, forKey: .type)) ?? MessageType.whitelistOp.rawValue
        self.op = (try? c.decode(String.self, forKey: .op)) ?? ""
        self.domain = (try? c.decode(String.self, forKey: .domain)) ?? ""
    }
}

/// extension -> host: open Lil Chromium's native Settings window.
/// Fire-and-forget; no extra fields. The host launches the dedicated
/// app-owned Settings URL targeted at Lil Chromium and never forwards
/// this to a browser.
public struct OpenSettingsMessage: Codable, Sendable {
    public let type: String

    public init() {
        self.type = MessageType.openSettings.rawValue
    }
}

/// extension -> host: launch `url` in `browser` via `open -b <bundleId>`.
/// Fire-and-forget; host validates the URL scheme and logs failures.
public struct OpenExternalMessage: Codable, Sendable {
    public let type: String
    public let browser: String
    public let url: String

    public init(browser: String, url: String) {
        self.type = MessageType.openExternal.rawValue
        self.browser = browser
        self.url = url
    }

    // Defensive decode: missing fields degrade to empty strings (the handler
    // then no-ops on an empty/invalid url or unknown browser).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.type = (try? c.decode(String.self, forKey: .type)) ?? MessageType.openExternal.rawValue
        self.browser = (try? c.decode(String.self, forKey: .browser)) ?? ""
        self.url = (try? c.decode(String.self, forKey: .url)) ?? ""
    }
}
