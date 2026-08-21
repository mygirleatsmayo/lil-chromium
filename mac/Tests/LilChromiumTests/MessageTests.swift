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
        #expect(msg.priorContext == nil)
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

    @Test func openCarriesTheExternalAppThatPrecededTheLil() throws {
        let msg = try Fixture.decode(OpenMessage.self, from: "message-open-prior-context")

        #expect(msg.priorContext == .externalApp(pid: 4242, bundleId: "com.apple.mail"))
    }

    @Test func restoreFocusCarriesTheSameTypedPriorContext() throws {
        let msg = try Fixture.decode(RestoreFocusMessage.self, from: "message-restore-focus")

        #expect(msg.type == "restore-focus")
        #expect(msg.priorContext == .externalApp(pid: 4242, bundleId: "com.apple.mail"))
    }

    @Test(arguments: [
        PriorContext.lil(windowId: 17),
        PriorContext.normalWindow(windowId: 23),
        PriorContext.externalApp(pid: 4242, bundleId: "com.apple.mail"),
    ])
    func everyPriorContextKindRoundTrips(_ original: PriorContext) throws {
        let decoded = try LilCodec.decode(PriorContext.self, from: LilCodec.encode(original))

        #expect(decoded == original)
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
    /// own identity, so the extension needs no second read of config.json.
    /// `fixtures/message-context.json` is the shared wire meaning (Issue #2
    /// Testing Decision 4); its keys are docs/PROTOCOL.md's closed context set.
    @Test func contextCarriesConfigObjectsAndHostIdentity() throws {
        let bytes = try Fixture.data("message-context")
        let wire = try jsonObject(bytes)
        let ctx = try Fixture.decode(ContextMessage.self, from: "message-context")

        #expect(wire.keys.sorted() == [
            "browser", "browserName", "ephemeralDefault", "fallbackBrowser",
            "hoverBar", "id", "knownBrowsers", "linkBehavior",
            "primaryBrowser", "primaryBrowserName", "searchEngine", "sleep", "type",
        ])

        // Host identity is the host's, not the config's.
        #expect(ctx.browser == "brave")
        #expect(ctx.browserName == "Brave")
        #expect(ctx.browser != ctx.primaryBrowser)
        // Routing targets come from the config.
        #expect(ctx.primaryBrowser == "helium")
        #expect(ctx.primaryBrowserName == "Helium")
        #expect(ctx.fallbackBrowser == "chrome")
        #expect(ctx.linkBehavior == "new-lil")
        // Config sections arrive whole.
        #expect(ctx.ephemeralDefault == "6h")
        #expect(ctx.sleep.afterMinutes == 45)
        #expect(ctx.sleep.formGuard == false)
        #expect(ctx.sleep.tint == "#3311aa")
        #expect(ctx.sleep.whitelist == ["mail.google.com"])
        #expect(ctx.searchEngine.name == "Kagi")
        #expect(ctx.searchEngine.template == "https://kagi.com/search?q=%s")
        #expect(ctx.hoverBar.style == "solid")
        #expect(ctx.hoverBar.tint == "#112233")
        // Browsers are the trimmed context shape: no bundle ids.
        #expect(ctx.knownBrowsers.map(\.slug) == ["helium", "brave"])
        #expect(ctx.knownBrowsers.map(\.name) == ["Helium", "Brave"])
        let wireText = try #require(String(data: bytes, encoding: .utf8))
        #expect(wireText.contains("bundleId") == false, "context wires never carry bundle ids")
    }

    /// A context built from a config round-trips unchanged through the wire.
    @Test func contextRoundTripsThroughEncoding() throws {
        let original = try Fixture.decode(ContextMessage.self, from: "message-context")
        let reloaded = try LilCodec.decode(ContextMessage.self, from: LilCodec.encode(original))

        #expect(reloaded.browser == original.browser)
        #expect(reloaded.sleep.whitelist == original.sleep.whitelist)
        #expect(reloaded.searchEngine.name == original.searchEngine.name)
        #expect(reloaded.hoverBar.tint == original.hoverBar.tint)
        #expect(reloaded.knownBrowsers.map(\.name) == original.knownBrowsers.map(\.name))
    }

    /// Reconnect `context` and Settings `config-update` share ContextPayload
    /// for every config field. Host identity stays on `context` only.
    @Test func contextAndConfigUpdateShareBrowserNormalization() throws {
        var config = try Fixture.decode(LilConfig.self, from: "config-v3-complete")
        config.hoverBar.revealHeight = 100

        let ctx = ContextMessage(id: "ctx-1", browser: "brave", config: config)
        let update = ConfigUpdateMessage(config: config)

        #expect(ctx.type == "context")
        #expect(ctx.id == "ctx-1")
        #expect(ctx.browser == "brave")
        #expect(ctx.browserName == "Brave")
        #expect(ctx.primaryBrowser == "helium")
        #expect(ctx.primaryBrowserName == "Helium")
        #expect(ctx.primaryBrowser == update.primaryBrowser)
        #expect(ctx.primaryBrowserName == update.primaryBrowserName)
        #expect(ctx.fallbackBrowser == update.fallbackBrowser)
        #expect(ctx.linkBehavior == update.linkBehavior)
        #expect(ctx.ephemeralDefault == update.ephemeralDefault)
        #expect(ctx.sleep.whitelist == update.sleep.whitelist)
        #expect(ctx.searchEngine.name == update.searchEngine.name)
        #expect(ctx.hoverBar.revealHeight == 48, "both messages carry the clamped value")
        #expect(ctx.hoverBar.revealHeight == update.hoverBar.revealHeight)
        #expect(ctx.knownBrowsers.map(\.slug) == ["helium", "chrome", "vivaldi"])
        #expect(ctx.knownBrowsers.map(\.slug) == update.knownBrowsers.map(\.slug))
        #expect(ctx.knownBrowsers.map(\.name) == update.knownBrowsers.map(\.name))
        #expect(ctx.knownBrowsers.map(\.installed) == update.knownBrowsers.map(\.installed))

        let empty = ContextMessage(id: "ctx-empty", browser: "chrome", config: .defaults)
        let emptyUpdate = ConfigUpdateMessage(config: .defaults)
        #expect(empty.knownBrowsers.count == BrowserTable.all.count)
        #expect(empty.knownBrowsers.map(\.slug) == emptyUpdate.knownBrowsers.map(\.slug))
        #expect(empty.knownBrowsers.allSatisfy { $0.installed == false })
        #expect(empty.primaryBrowserName == emptyUpdate.primaryBrowserName)
    }

    // MARK: - config-update (issue #12 hot-apply)

    /// The shared wire meaning: a native Settings write published to every
    /// live relay carries the normalized full configuration — the context
    /// payload minus the host's own identity, which each worker already has.
    @Test func configUpdateDecodesFromFixture() throws {
        let bytes = try Fixture.data("message-config-update")
        let wire = try jsonObject(bytes)
        let msg = try Fixture.decode(ConfigUpdateMessage.self, from: "message-config-update")

        #expect(wire.keys.sorted() == [
            "ephemeralDefault", "fallbackBrowser", "hoverBar", "knownBrowsers",
            "linkBehavior", "primaryBrowser", "primaryBrowserName", "searchEngine",
            "sleep", "type",
        ])
        #expect(msg.type == "config-update")
        #expect(msg.primaryBrowser == "vivaldi")
        #expect(msg.primaryBrowserName == "Vivaldi")
        #expect(msg.fallbackBrowser == "chrome")
        #expect(msg.linkBehavior == "same-lil")
        #expect(msg.ephemeralDefault == "12h")
        #expect(msg.sleep.afterMinutes == 60)
        #expect(msg.sleep.audioGuard == false)
        #expect(msg.sleep.whitelist == ["example.com", "mail.google.com"])
        #expect(msg.searchEngine.name == "Bing")
        #expect(msg.hoverBar.style == "glass")
        #expect(msg.hoverBar.tint == "#4455ff")
        #expect(msg.hoverBar.revealHeight == 8)
        #expect(msg.knownBrowsers.map(\.slug) == ["vivaldi", "chrome"])
        let wireText = try #require(String(data: bytes, encoding: .utf8))
        #expect(wireText.contains("bundleId") == false, "config-update wires never carry bundle ids")
    }

    /// The app builds the broadcast straight from the config it just wrote:
    /// trimmed browsers (no bundle ids), resolved display names, and the
    /// model-clamped reveal height.
    @Test func configUpdateCarriesTheNormalizedFullConfig() throws {
        var config = try Fixture.decode(LilConfig.self, from: "config-v3-complete")
        config.hoverBar.revealHeight = 100 // the model clamps before broadcast

        let msg = ConfigUpdateMessage(config: config)
        let wireText = try #require(String(data: LilCodec.encode(msg), encoding: .utf8))

        #expect(msg.type == "config-update")
        #expect(msg.primaryBrowser == "helium")
        #expect(msg.primaryBrowserName == "Helium")
        #expect(msg.fallbackBrowser == "chrome")
        #expect(msg.linkBehavior == "new-lil")
        #expect(msg.ephemeralDefault == "6h")
        #expect(msg.sleep.afterMinutes == 45)
        #expect(msg.searchEngine.name == "Kagi")
        #expect(msg.hoverBar.style == "solid")
        #expect(msg.hoverBar.tint == "#112233")
        #expect(msg.hoverBar.revealHeight == 48, "the broadcast carries the clamped value")
        #expect(msg.knownBrowsers.map(\.slug) == ["helium", "chrome", "vivaldi"])
        #expect(msg.knownBrowsers.map(\.installed) == [true, true, false])
        #expect(wireText.contains("bundleId") == false)
    }

    /// With no scan in the config, the broadcast still carries the full
    /// catalog marked not-installed — the same fallback the host's context
    /// reply uses, so the extension's menu never loses its choices.
    @Test func configUpdateFallsBackToCatalogBrowsers() throws {
        let msg = ConfigUpdateMessage(config: .defaults)

        #expect(msg.knownBrowsers.count == BrowserTable.all.count)
        #expect(msg.knownBrowsers.allSatisfy { $0.installed == false })
        #expect(msg.primaryBrowserName == "Helium")
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
        let envelope = try Fixture.decode(LilMessage.self, from: "message-context")

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
