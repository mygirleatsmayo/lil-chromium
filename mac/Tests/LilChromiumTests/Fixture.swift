import Foundation
import XCTest

/// Loader for the shared contract fixtures in `Fixtures/`.
///
/// There is ONE fixture set for the whole test target: every suite reads the
/// same JSON files, so a contract change is expressed in one place instead of
/// once per suite. Fixtures are literal wire/disk bytes — the independent source
/// of truth a test asserts against.
enum Fixture {

    struct Missing: Swift.Error, CustomStringConvertible {
        let name: String
        var description: String { "fixture Fixtures/\(name).json not found in the test bundle" }
    }

    /// Raw bytes of `Fixtures/<name>.json`.
    static func data(_ name: String) throws -> Data {
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "json", subdirectory: "Fixtures"
        ) else {
            throw Missing(name: name)
        }
        return try Data(contentsOf: url)
    }

    /// Decode `Fixtures/<name>.json` as `type`.
    static func decode<T: Decodable>(_ type: T.Type, from name: String) throws -> T {
        try JSONDecoder().decode(type, from: data(name))
    }
}

/// Parse arbitrary JSON bytes into a dictionary, for asserting on encoded output.
func jsonObject(_ data: Data, file: StaticString = #filePath, line: UInt = #line) throws -> [String: Any] {
    let obj = try JSONSerialization.jsonObject(with: data)
    let dict = try XCTUnwrap(obj as? [String: Any], "expected a JSON object", file: file, line: line)
    return dict
}
