import Foundation
import Testing
@testable import LilShared

/// Manifest generation must cover every catalogued installation and skip
/// support dirs that are not present — including profile folders, which are
/// never install targets.
struct NativeHostManifestTests {

    private static let scriptURL = Fixture.directory
        .deletingLastPathComponent()
        .appendingPathComponent("scripts/install-host.sh")

    private static let hostName = "com.lilchromium.relay"
    private static let extensionOrigin = "chrome-extension://oofeehjoocddelicpmnpbafmbalaakge/"

    @Test func installScriptListsTheFullCatalog() throws {
        let text = try String(contentsOf: Self.scriptURL, encoding: .utf8)
        #expect(browserDirs(inInstallScript: text) == BrowserTable.nativeHostSupportDirectories)
    }

    @Test func writingManifestsCoversEveryExistingCatalogDir() throws {
        let home = try scratchHome()
        defer { try? FileManager.default.removeItem(at: home) }

        let written = try runInstall(home: home, existing: BrowserTable.nativeHostSupportDirectories)
        #expect(written == BrowserTable.nativeHostSupportDirectories)

        let manifest = try readManifest(home: home, relativeDir: "Google/Chrome")
        #expect(manifest["name"] as? String == Self.hostName)
        #expect(manifest["type"] as? String == "stdio")
        #expect(manifest["path"] as? String == "/tmp/LilChromium.app/Contents/MacOS/lilchromium-host")
        let origins = try #require(manifest["allowed_origins"] as? [String])
        #expect(origins == [Self.extensionOrigin])
    }

    @Test func missingInstallationsAreSkipped() throws {
        let home = try scratchHome()
        defer { try? FileManager.default.removeItem(at: home) }

        let existing = ["Google/Chrome", "net.imput.helium", "Arc/User Data"]
        let written = try runInstall(home: home, existing: existing)
        #expect(written == existing)
        #expect(written.contains("Google/Chrome Beta") == false)
        #expect(written.contains("chrome-beta") == false)
    }

    @Test func profileDirectoriesAreNeverInstallTargets() throws {
        let home = try scratchHome()
        defer { try? FileManager.default.removeItem(at: home) }

        let written = try runInstall(
            home: home,
            existing: [
                "Google/Chrome",
                "Google/Chrome/Default",
                "Google/Chrome/Profile 1",
                "NotABrowser",
            ]
        )
        #expect(written == ["Google/Chrome"])

        let support = home.appendingPathComponent("Library/Application Support")
        let manifestName = "NativeMessagingHosts/\(Self.hostName).json"
        #expect(
            FileManager.default.fileExists(
                atPath: support.appendingPathComponent("Google/Chrome/Default/\(manifestName)").path
            ) == false
        )
        #expect(
            FileManager.default.fileExists(
                atPath: support.appendingPathComponent("NotABrowser/\(manifestName)").path
            ) == false
        )
    }

    // MARK: - helpers

    private func scratchHome() throws -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("lil-nmh-\(UUID().uuidString)")
    }

    private func runInstall(home: URL, existing: [String]) throws -> [String] {
        let fm = FileManager.default
        let support = home.appendingPathComponent("Library/Application Support")
        for rel in existing {
            try fm.createDirectory(
                at: support.appendingPathComponent(rel),
                withIntermediateDirectories: true
            )
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [Self.scriptURL.path, "/tmp/LilChromium.app"]
        proc.environment = [
            "HOME": home.path,
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        ]
        proc.standardOutput = Pipe()
        proc.standardError = Pipe()
        try proc.run()
        proc.waitUntilExit()
        guard proc.terminationStatus == 0 else {
            throw InstallHostFailed(status: proc.terminationStatus)
        }

        let prefix = support.standardizedFileURL.path + "/"
        let suffix = "/NativeMessagingHosts/\(Self.hostName).json"
        guard let enumerator = fm.enumerator(at: support, includingPropertiesForKeys: nil) else {
            return []
        }
        var dirs: [String] = []
        while let url = enumerator.nextObject() as? URL {
            let path = url.standardizedFileURL.path
            guard path.hasSuffix(suffix), path.hasPrefix(prefix) else { continue }
            let rel = String(path.dropFirst(prefix.count).dropLast(suffix.count))
            dirs.append(rel)
        }
        return BrowserTable.nativeHostSupportDirectories.filter { dirs.contains($0) }
    }

    private struct InstallHostFailed: Error {
        let status: Int32
    }

    private func readManifest(home: URL, relativeDir: String) throws -> [String: Any] {
        let url = home
            .appendingPathComponent("Library/Application Support")
            .appendingPathComponent(relativeDir)
            .appendingPathComponent("NativeMessagingHosts/\(Self.hostName).json")
        let obj = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        guard let dict = obj as? [String: Any] else { throw Fixture.NotJSONObject() }
        return dict
    }

    private func browserDirs(inInstallScript text: String) -> [String] {
        guard let start = text.range(of: "BROWSER_DIRS=("),
              let end = text[start.upperBound...].range(of: "\n)")
        else { return [] }
        let body = text[start.upperBound..<end.lowerBound]
        return body.split(separator: "\n").compactMap { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("\""), trimmed.hasSuffix("\"") else { return nil }
            return String(trimmed.dropFirst().dropLast())
        }
    }
}
