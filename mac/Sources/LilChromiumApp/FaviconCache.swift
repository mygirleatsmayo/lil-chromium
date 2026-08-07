import AppKit
import Foundation

/// Async favicon loader with a two-tier cache (in-memory NSCache + on-disk PNG).
///
/// Source: Google's S2 favicon service
/// `https://www.google.com/s2/favicons?domain=<host>&sz=64` — returns a generic
/// globe for unknown hosts (never 404), so a fetched image is always usable.
/// It's unofficial and rate-limited, hence the disk cache.
///
/// Contract:
///   - `placeholder` is a globe SF Symbol, returned instantly.
///   - `icon(for:completion:)` returns a cached image synchronously via the
///     completion when hot, or fetches async and calls completion on the MAIN
///     thread. Never blocks the main thread.
///   - Callers guard the completion by checking the row still shows that host
///     (see PaletteRowView), so a slow fetch landing after the row was reused
///     is a no-op.
///
/// Threading: this type is main-thread confined by contract. All public/private
/// methods must be called on the main thread (the palette is UI code, so this
/// holds naturally); the only work that leaves the main thread is the disk read
/// and the URLSession request, both of which hop back to main before touching
/// any cache state. NSCache itself is thread-safe regardless.
final class FaviconCache {

    static let shared = FaviconCache()

    /// In-memory cache keyed by host. NSCache is thread-safe and self-evicting.
    private let memory = NSCache<NSString, NSImage>()

    /// Disk cache dir: ~/.lilchromium/favicons/. Created lazily.
    private let diskDir: URL

    /// URLSession with default config (respects system proxy/TLS). Shared.
    private let session: URLSession

    /// Hosts with an in-flight fetch, so we don't hammer the service.
    private var inFlight = Set<String>()

    /// A reusable globe placeholder (tinted secondary).
    let placeholder: NSImage

    private init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        diskDir = home.appendingPathComponent(".lilchromium/favicons", isDirectory: true)
        try? FileManager.default.createDirectory(at: diskDir, withIntermediateDirectories: true)

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 8
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)

        placeholder = FaviconCache.makePlaceholder()
    }

    /// Return an image for `host`. Calls `completion` on the main thread with the
    /// final favicon (or nil if the fetch fails — caller keeps the placeholder).
    /// If a cached image exists it's delivered synchronously before returning.
    func icon(for host: String, completion: @escaping (NSImage?) -> Void) {
        let key = host.lowercased() as NSString

        // 1. Memory hit.
        if let img = memory.object(forKey: key) {
            completion(img)
            return
        }

        // 2. Disk hit (read off the main thread, then decode + cache on main).
        let diskURL = diskPath(for: host)
        let fm = FileManager.default
        if fm.fileExists(atPath: diskURL.path) {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let data = try? Data(contentsOf: diskURL)
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if let data = data, let img = NSImage(data: data) {
                        self.memory.setObject(img, forKey: key)
                        completion(img)
                    } else {
                        // Corrupt cache file → refetch.
                        try? fm.removeItem(at: diskURL)
                        self.fetch(host: host, completion: completion)
                    }
                }
            }
            return
        }

        // 3. Network fetch.
        fetch(host: host, completion: completion)
    }

    // MARK: - Network

    private func fetch(host: String, completion: @escaping (NSImage?) -> Void) {
        guard !host.isEmpty else { completion(nil); return }
        // Coalesce concurrent requests for the same host: still call completion
        // for this caller, but only issue one network request.
        let alreadyFetching = inFlight.contains(host)
        inFlight.insert(host)

        guard let url = faviconURL(for: host) else { completion(nil); return }
        if alreadyFetching {
            // Another fetch is in flight; when it finishes it writes to disk +
            // memory. Fall back to a fresh request here anyway is wasteful, so
            // just deliver nil now (placeholder stays) — the next render hits
            // the warmed cache. Keeps this simple and non-blocking.
            completion(nil)
            return
        }

        let key = host.lowercased() as NSString
        let diskURL = diskPath(for: host)

        let task = session.dataTask(with: url) { [weak self] data, response, _ in
            // Runs on a URLSession background queue. Hop to main for all state.
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.inFlight.remove(host)

                guard
                    let data = data, !data.isEmpty,
                    let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                    let img = NSImage(data: data)
                else {
                    completion(nil)
                    return
                }
                self.memory.setObject(img, forKey: key)
                // Persist to disk off the main thread (best-effort).
                DispatchQueue.global(qos: .utility).async {
                    try? data.write(to: diskURL, options: .atomic)
                }
                completion(img)
            }
        }
        task.resume()
    }

    // MARK: - Helpers

    private func faviconURL(for host: String) -> URL? {
        var comps = URLComponents()
        comps.scheme = "https"
        comps.host = "www.google.com"
        comps.path = "/s2/favicons"
        comps.queryItems = [
            URLQueryItem(name: "domain", value: host),
            URLQueryItem(name: "sz", value: "64")
        ]
        return comps.url
    }

    private func diskPath(for host: String) -> URL {
        // Sanitize host into a safe filename (hosts can't legally contain "/",
        // but be defensive against odd input).
        let safe = host.lowercased()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        return diskDir.appendingPathComponent("\(safe).png")
    }

    private static func makePlaceholder() -> NSImage {
        let cfg = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
        let img = NSImage(systemSymbolName: "globe", accessibilityDescription: "site")?
            .withSymbolConfiguration(cfg)
        img?.isTemplate = true
        return img ?? NSImage(size: NSSize(width: 20, height: 20))
    }
}
