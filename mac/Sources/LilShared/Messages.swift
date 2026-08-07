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
public struct OpenMessage: Codable, Sendable {
    public let type: String
    public let url: String
    public let left: Int
    public let top: Int

    public init(url: String, left: Int, top: Int) {
        self.type = MessageType.open.rawValue
        self.url = url
        self.left = left
        self.top = top
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
public struct ContextMessage: Codable, Sendable {
    public let type: String
    public let id: String
    public let browser: String
    public let browserName: String
    public let defaultBrowser: String
    public let defaultBrowserName: String
    public let fallbackBrowser: String
    public let linkBehavior: String
    public let knownBrowsers: [ContextBrowser]

    public init(
        id: String,
        browser: String,
        browserName: String,
        defaultBrowser: String,
        defaultBrowserName: String,
        fallbackBrowser: String,
        linkBehavior: String,
        knownBrowsers: [ContextBrowser]
    ) {
        self.type = MessageType.context.rawValue
        self.id = id
        self.browser = browser
        self.browserName = browserName
        self.defaultBrowser = defaultBrowser
        self.defaultBrowserName = defaultBrowserName
        self.fallbackBrowser = fallbackBrowser
        self.linkBehavior = linkBehavior
        self.knownBrowsers = knownBrowsers
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
