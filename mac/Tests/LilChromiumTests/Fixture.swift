import Foundation

/// Loader for the shared contract fixtures in the repo-root `fixtures/`
/// directory.
///
/// There is ONE fixture set for every consumer: this Swift suite and the
/// Node/MV3 extension suite (Issue #2 Testing Decision 4) read the same JSON
/// files, so a contract change is expressed in one place and cannot land in
/// only one component. Fixtures are literal wire/disk bytes — the independent
/// source of truth a test asserts against.
enum Fixture {

    struct Missing: Swift.Error, CustomStringConvertible {
        let name: String
        var description: String { "fixture fixtures/\(name).json not found (looked in \(directory.path))" }
    }

    struct NotJSONObject: Swift.Error, CustomStringConvertible {
        var description: String { "expected a top-level JSON object" }
    }

    /// The repo-root `fixtures/` directory, located relative to this source
    /// file — never via the user's home directory or the process's cwd.
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // LilChromiumTests/
        .deletingLastPathComponent()  // Tests/
        .deletingLastPathComponent()  // mac/
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("fixtures", isDirectory: true)

    /// Raw bytes of `fixtures/<name>.json`.
    static func data(_ name: String) throws -> Data {
        let url = directory.appendingPathComponent("\(name).json", isDirectory: false)
        guard let bytes = try? Data(contentsOf: url) else { throw Missing(name: name) }
        return bytes
    }

    /// Decode `fixtures/<name>.json` as `type`.
    static func decode<T: Decodable>(_ type: T.Type, from name: String) throws -> T {
        try JSONDecoder().decode(type, from: data(name))
    }

    /// Decode fixture `bytes` as `type`.
    static func decode<T: Decodable>(_ type: T.Type, from bytes: Data) throws -> T {
        try JSONDecoder().decode(type, from: bytes)
    }

    /// Wire bytes of a `context` reply, composed per docs/PROTOCOL.md: the
    /// full config objects verbatim (the `config-v2-complete` fixture) plus
    /// the replying host's own identity, with `knownBrowsers` trimmed to the
    /// context shape (no `bundleId`). The config sections live in exactly one
    /// fixture; the context meaning is this composition, stated once here.
    static func contextData(id: String = "ctx-1", browser: String = "brave", browserName: String = "Brave") throws -> Data {
        var wire = try jsonObject(data("config-v2-complete"))
        let browsers = (wire["knownBrowsers"] as? [[String: Any]]) ?? []
        wire["type"] = "context"
        wire["id"] = id
        wire["browser"] = browser
        wire["browserName"] = browserName
        // The host names the default browser from the config's knownBrowsers.
        wire["defaultBrowserName"] = browsers.first { $0["slug"] as? String == wire["defaultBrowser"] as? String }?["name"]
        wire["knownBrowsers"] = browsers.map { $0.filter { $0.key != "bundleId" } }
        return try JSONSerialization.data(withJSONObject: wire, options: [.sortedKeys])
    }
}

/// Parse arbitrary JSON bytes into a dictionary, for asserting on encoded output.
func jsonObject(_ data: Data) throws -> [String: Any] {
    let obj = try JSONSerialization.jsonObject(with: data)
    guard let dict = obj as? [String: Any] else { throw Fixture.NotJSONObject() }
    return dict
}
