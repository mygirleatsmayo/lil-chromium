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
}

/// Parse arbitrary JSON bytes into a dictionary, for asserting on encoded output.
func jsonObject(_ data: Data) throws -> [String: Any] {
    let obj = try JSONSerialization.jsonObject(with: data)
    guard let dict = obj as? [String: Any] else { throw Fixture.NotJSONObject() }
    return dict
}
