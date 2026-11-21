import AppKit
import Foundation
import Testing
@testable import LilChromiumApp

/// Favicon fetch coalescing: rows that ask for a host while its fetch is in
/// flight all get the result, and the service is hit once (#40 P3).
@MainActor
struct FaviconCacheTests {

    @Test("A caller joining an in-flight fetch gets the image; one fetch runs", .bug(id: 40))
    func joiningAnInFlightFetchGetsTheImage() async throws {
        let diskDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("favicon-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: diskDir) }

        var pending: [@Sendable (Data?, URLResponse?) -> Void] = []
        let cache = FaviconCache(diskDir: diskDir) { _, done in pending.append(done) }

        var delivered: [NSImage?] = []
        cache.icon(for: "example.com") { delivered.append($0) }
        cache.icon(for: "example.com") { delivered.append($0) }  // joins in flight
        #expect(pending.count == 1)

        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 4, pixelsHigh: 4,
                                      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                      isPlanar: false, colorSpaceName: .deviceRGB,
                                      bytesPerRow: 0, bitsPerPixel: 0)
        let png = bitmap?.representation(using: .png, properties: [:]) ?? Data()
        let ok = HTTPURLResponse(url: URL(string: "https://www.google.com")!,
                                 statusCode: 200, httpVersion: nil, headerFields: nil)
        pending.forEach { $0(png, ok) }

        // The cache delivers on a main-queue hop the fake response just
        // enqueued; the main queue is FIFO, so a block enqueued now runs after
        // it. Resuming there drains delivery without waiting on a callback
        // that a regression might never make.
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }

        #expect(delivered.count == 2)
        #expect(delivered.allSatisfy { $0 != nil })
    }
}
