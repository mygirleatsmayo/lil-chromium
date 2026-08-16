import XCTest
@testable import LilShared

/// Wire behavior for the app <-> host <-> extension messages in
/// docs/PROTOCOL.md: what an older component may send, and exactly what bytes
/// this component puts back on the wire.
final class MessageTests: XCTestCase {

    // MARK: - open

    /// v0.3 compatibility: an `open` written before incognito lils existed still
    /// decodes, and means "not incognito".
    func testLegacyOpenDecodesWithoutIncognito() throws {
        let msg = try Fixture.decode(OpenMessage.self, from: "message-open-legacy")

        XCTAssertEqual(msg.type, "open")
        XCTAssertEqual(msg.url, "https://example.com/docs")
        XCTAssertEqual(msg.left, 120)
        XCTAssertEqual(msg.top, 80)
        XCTAssertNil(msg.incognito)
    }

    /// A normal lil carries no `incognito` key at all — the extension must not
    /// have to distinguish `false` from `null`.
    func testNormalOpenOmitsIncognitoOnTheWire() throws {
        let encoded = try LilCodec.encode(OpenMessage(url: "https://example.com", left: 1, top: 2))
        let out = try jsonObject(encoded)

        XCTAssertEqual(out.keys.sorted(), ["left", "top", "type", "url"])
    }

    /// Palette ⌘-Enter: the incognito flag reaches the extension.
    func testIncognitoOpenCarriesTheFlag() throws {
        let encoded = try LilCodec.encode(OpenMessage(url: "https://example.com", left: 1, top: 2, incognito: true))
        XCTAssertEqual(try jsonObject(encoded)["incognito"] as? Bool, true)
    }

    // MARK: - ping / pong

    /// v0.3 compatibility: a pong from a host that predates per-browser sockets
    /// reports an unknown browser rather than failing the decode.
    func testLegacyPongDefaultsToUnknownBrowser() throws {
        let pong = try Fixture.decode(PongMessage.self, from: "message-pong-legacy")

        XCTAssertEqual(pong.id, "7f1c")
        XCTAssertTrue(pong.extensionConnected)
        XCTAssertEqual(pong.browser, "unknown")
    }

    // MARK: - context

    /// The context reply carries the full config objects verbatim plus the host's
    /// own identity, so the extension needs no second read of config.json.
    func testContextCarriesConfigObjectsAndHostIdentity() throws {
        let ctx = try Fixture.decode(ContextMessage.self, from: "message-context")

        // Host identity is the host's, not the config's.
        XCTAssertEqual(ctx.browser, "brave")
        XCTAssertEqual(ctx.browserName, "Brave")
        // Routing targets come from the config.
        XCTAssertEqual(ctx.defaultBrowser, "helium")
        XCTAssertEqual(ctx.defaultBrowserName, "Helium")
        XCTAssertEqual(ctx.fallbackBrowser, "chrome")
        // Config sections arrive whole.
        XCTAssertEqual(ctx.ephemeralDefault, "6h")
        XCTAssertEqual(ctx.sleep.afterMinutes, 45)
        XCTAssertFalse(ctx.sleep.formGuard)
        XCTAssertEqual(ctx.searchEngine.template, "https://kagi.com/search?q=%s")
        XCTAssertEqual(ctx.hoverBar.style, "solid")
        XCTAssertEqual(ctx.hoverBar.tint, "#112233")
        // Browsers are the trimmed context shape: no bundle ids.
        XCTAssertEqual(ctx.knownBrowsers.map(\.slug), ["helium", "brave"])
    }

    /// A context built from a config round-trips unchanged through the wire.
    func testContextRoundTripsThroughEncoding() throws {
        let original = try Fixture.decode(ContextMessage.self, from: "message-context")
        let reloaded = try LilCodec.decode(ContextMessage.self, from: LilCodec.encode(original))

        XCTAssertEqual(reloaded.browser, original.browser)
        XCTAssertEqual(reloaded.sleep.whitelist, original.sleep.whitelist)
        XCTAssertEqual(reloaded.searchEngine.name, original.searchEngine.name)
        XCTAssertEqual(reloaded.hoverBar.tint, original.hoverBar.tint)
        XCTAssertEqual(reloaded.knownBrowsers.map(\.name), original.knownBrowsers.map(\.name))
    }

    // MARK: - history-result

    /// Chrome omits fields on some rows; one odd row must never fail the batch.
    func testHistoryResultToleratesSparseRows() throws {
        let result = try Fixture.decode(HistoryResultMessage.self, from: "message-history-result")

        XCTAssertEqual(result.id, "h-1")
        let sparse = try XCTUnwrap(result.items.first { $0.url == "https://docs.swift.org/guide" })
        XCTAssertEqual(sparse.title, "")
        XCTAssertEqual(sparse.visitCount, 0)
        XCTAssertEqual(sparse.typedCount, 0)
        XCTAssertEqual(sparse.lastVisitTime, 0)
    }

    // MARK: - host-only messages

    /// The host validates rather than trusts: a malformed edit degrades to empty
    /// fields, which its handler drops.
    func testWhitelistOpDecodesDefensively() throws {
        let msg = try LilCodec.decode(WhitelistOpMessage.self, from: Data(#"{"type":"whitelist-op"}"#.utf8))

        XCTAssertEqual(msg.op, "")
        XCTAssertEqual(msg.domain, "")
    }

    func testOpenExternalDecodesDefensively() throws {
        let msg = try LilCodec.decode(OpenExternalMessage.self, from: Data(#"{"type":"open-external"}"#.utf8))

        XCTAssertEqual(msg.browser, "")
        XCTAssertEqual(msg.url, "")
    }

    /// Dispatch only needs `type` and `id`; unknown fields never break routing.
    func testEnvelopeDecodesAnyMessageForDispatch() throws {
        let envelope = try Fixture.decode(LilMessage.self, from: "message-context")

        XCTAssertEqual(envelope.type, "context")
        XCTAssertEqual(envelope.id, "ctx-1")
    }

    // MARK: - Line framing

    /// The app <-> host transport is one compact JSON object per line.
    func testEncodedLineIsCompactAndNewlineTerminated() throws {
        let line = try LilCodec.encodeLine(PingMessage(id: "abc"))
        let text = try XCTUnwrap(String(data: line, encoding: .utf8))

        XCTAssertEqual(text, "{\"id\":\"abc\",\"type\":\"ping\"}\n", "sorted keys, no padding, single trailing newline")
    }

    func testDecodeLineToleratesTheTrailingNewline() throws {
        let framed = try LilCodec.encodeLine(PingMessage(id: "abc"))
        XCTAssertEqual(try LilCodec.decodeLine(PingMessage.self, from: framed).id, "abc")

        var bare = framed
        bare.removeLast()
        XCTAssertEqual(try LilCodec.decodeLine(PingMessage.self, from: bare).id, "abc")
    }

    /// A socket read can split a line anywhere; the buffer only yields complete
    /// lines and keeps the remainder for the next read.
    func testLineBufferReassemblesSplitReads() throws {
        let buffer = LineBuffer()

        XCTAssertEqual(buffer.append(Data(#"{"type":"pi"#.utf8)).count, 0)
        let lines = buffer.append(Data("ng\",\"id\":\"a\"}\n{\"type\":\"ping\",\"id\":\"b\"}\n{\"partial\":".utf8))

        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(try LilCodec.decodeLine(PingMessage.self, from: lines[0]).id, "a")
        XCTAssertEqual(try LilCodec.decodeLine(PingMessage.self, from: lines[1]).id, "b")
        XCTAssertEqual(String(data: buffer.pending, encoding: .utf8), "{\"partial\":")
    }
}
