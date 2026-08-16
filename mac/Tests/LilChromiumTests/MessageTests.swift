import Foundation
import Testing
@testable import LilShared

/// Wire behavior for the app <-> host <-> extension messages in
/// docs/PROTOCOL.md: what an older component may send, and exactly what bytes
/// this component puts back on the wire.
struct MessageTests {

    // MARK: - open

    /// v0.3 compatibility: an `open` written before incognito lils existed still
    /// decodes, and means "not incognito".
    @Test func legacyOpenDecodesWithoutIncognito() throws {
        let msg = try Fixture.decode(OpenMessage.self, from: "message-open-legacy")

        #expect(msg.type == "open")
        #expect(msg.url == "https://example.com/docs")
        #expect(msg.left == 120)
        #expect(msg.top == 80)
        #expect(msg.incognito == nil)
    }

    /// A normal lil carries no `incognito` key at all — the extension must not
    /// have to distinguish `false` from `null`.
    @Test func normalOpenOmitsIncognitoOnTheWire() throws {
        let encoded = try LilCodec.encode(OpenMessage(url: "https://example.com", left: 1, top: 2))
        let out = try jsonObject(encoded)

        #expect(out.keys.sorted() == ["left", "top", "type", "url"])
    }

    /// Palette ⌘-Enter: the incognito flag reaches the extension.
    @Test func incognitoOpenCarriesTheFlag() throws {
        let encoded = try LilCodec.encode(OpenMessage(url: "https://example.com", left: 1, top: 2, incognito: true))
        let out = try jsonObject(encoded)
        #expect(out["incognito"] as? Bool == true)
    }

    // MARK: - ping / pong

    /// v0.3 compatibility: a pong from a host that predates per-browser sockets
    /// reports an unknown browser rather than failing the decode.
    @Test func legacyPongDefaultsToUnknownBrowser() throws {
        let pong = try Fixture.decode(PongMessage.self, from: "message-pong-legacy")

        #expect(pong.id == "7f1c")
        #expect(pong.extensionConnected)
        #expect(pong.browser == "unknown")
    }

    // MARK: - context

    /// The context reply carries the full config objects verbatim plus the host's
    /// own identity, so the extension needs no second read of config.json. The
    /// wire bytes are composed from the config fixture (see Fixture.contextData)
    /// so the config sections are expressed in exactly one fixture.
    @Test func contextCarriesConfigObjectsAndHostIdentity() throws {
        let cfg = try Fixture.decode(LilConfig.self, from: "config-v2-complete")
        let wire = try Fixture.contextData(browser: "brave", browserName: "Brave")
        let ctx = try Fixture.decode(ContextMessage.self, from: wire)

        // Host identity is the host's, not the config's.
        #expect(ctx.browser == "brave")
        #expect(ctx.browserName == "Brave")
        #expect(ctx.browser != ctx.defaultBrowser)
        // Routing targets come from the config.
        #expect(ctx.defaultBrowser == cfg.defaultBrowser)
        #expect(ctx.defaultBrowserName == "Helium")
        #expect(ctx.fallbackBrowser == cfg.fallbackBrowser)
        #expect(ctx.linkBehavior == cfg.linkBehavior)
        // Config sections arrive whole, verbatim from config.json.
        #expect(ctx.ephemeralDefault == cfg.ephemeralDefault)
        #expect(ctx.sleep.afterMinutes == cfg.sleep.afterMinutes)
        #expect(ctx.sleep.formGuard == cfg.sleep.formGuard)
        #expect(ctx.sleep.tint == cfg.sleep.tint)
        #expect(ctx.sleep.whitelist == cfg.sleep.whitelist)
        #expect(ctx.searchEngine.name == cfg.searchEngine.name)
        #expect(ctx.searchEngine.template == cfg.searchEngine.template)
        #expect(ctx.hoverBar.style == cfg.hoverBar.style)
        #expect(ctx.hoverBar.tint == cfg.hoverBar.tint)
        // Browsers are the trimmed context shape: the config's list, no bundle ids.
        #expect(ctx.knownBrowsers.map(\.slug) == cfg.knownBrowsers.map(\.slug))
        #expect(ctx.knownBrowsers.map(\.name) == cfg.knownBrowsers.map(\.name))
        #expect(ctx.knownBrowsers.map(\.installed) == cfg.knownBrowsers.map(\.installed))
        let wireText = try #require(String(data: wire, encoding: .utf8))
        #expect(wireText.contains("bundleId") == false, "context wires never carry bundle ids")
    }

    /// A context built from a config round-trips unchanged through the wire.
    @Test func contextRoundTripsThroughEncoding() throws {
        let original = try Fixture.decode(ContextMessage.self, from: Fixture.contextData())
        let reloaded = try LilCodec.decode(ContextMessage.self, from: LilCodec.encode(original))

        #expect(reloaded.browser == original.browser)
        #expect(reloaded.sleep.whitelist == original.sleep.whitelist)
        #expect(reloaded.searchEngine.name == original.searchEngine.name)
        #expect(reloaded.hoverBar.tint == original.hoverBar.tint)
        #expect(reloaded.knownBrowsers.map(\.name) == original.knownBrowsers.map(\.name))
    }

    // MARK: - history-result

    /// Chrome omits fields on some rows; one odd row must never fail the batch.
    @Test func historyResultToleratesSparseRows() throws {
        let result = try Fixture.decode(HistoryResultMessage.self, from: "message-history-result")

        #expect(result.id == "h-1")
        let sparse = try #require(result.items.first { $0.url == "https://docs.swift.org/guide" })
        #expect(sparse.title == "")
        #expect(sparse.visitCount == 0)
        #expect(sparse.typedCount == 0)
        #expect(sparse.lastVisitTime == 0)
    }

    // MARK: - host-only messages

    /// The host validates rather than trusts: a malformed edit degrades to empty
    /// fields, which its handler drops.
    @Test func whitelistOpDecodesDefensively() throws {
        let msg = try LilCodec.decode(WhitelistOpMessage.self, from: Data(#"{"type":"whitelist-op"}"#.utf8))

        #expect(msg.op == "")
        #expect(msg.domain == "")
    }

    @Test func openExternalDecodesDefensively() throws {
        let msg = try LilCodec.decode(OpenExternalMessage.self, from: Data(#"{"type":"open-external"}"#.utf8))

        #expect(msg.browser == "")
        #expect(msg.url == "")
    }

    /// Dispatch only needs `type` and `id`; unknown fields never break routing.
    @Test func envelopeDecodesAnyMessageForDispatch() throws {
        let envelope = try Fixture.decode(LilMessage.self, from: Fixture.contextData())

        #expect(envelope.type == "context")
        #expect(envelope.id == "ctx-1")
    }

    // MARK: - Line framing

    /// The app <-> host transport is one compact JSON object per line.
    @Test func encodedLineIsCompactAndNewlineTerminated() throws {
        let line = try LilCodec.encodeLine(PingMessage(id: "abc"))
        let text = try #require(String(data: line, encoding: .utf8))

        #expect(text == "{\"id\":\"abc\",\"type\":\"ping\"}\n", "sorted keys, no padding, single trailing newline")
    }

    @Test func decodeLineToleratesTheTrailingNewline() throws {
        let framed = try LilCodec.encodeLine(PingMessage(id: "abc"))
        let terminated = try LilCodec.decodeLine(PingMessage.self, from: framed)
        #expect(terminated.id == "abc")

        var bare = framed
        bare.removeLast()
        let unterminated = try LilCodec.decodeLine(PingMessage.self, from: bare)
        #expect(unterminated.id == "abc")
    }

    /// A socket read can split a line anywhere; the buffer only yields complete
    /// lines and keeps the remainder for the next read.
    @Test func lineBufferReassemblesSplitReads() throws {
        let buffer = LineBuffer()

        #expect(buffer.append(Data(#"{"type":"pi"#.utf8)).count == 0)
        let lines = buffer.append(Data("ng\",\"id\":\"a\"}\n{\"type\":\"ping\",\"id\":\"b\"}\n{\"partial\":".utf8))

        #expect(lines.count == 2)
        let first = try LilCodec.decodeLine(PingMessage.self, from: lines[0])
        let second = try LilCodec.decodeLine(PingMessage.self, from: lines[1])
        #expect(first.id == "a")
        #expect(second.id == "b")
        #expect(String(data: buffer.pending, encoding: .utf8) == "{\"partial\":")
    }
}
