import Foundation

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// Shared read-merge-write machinery for `config.json`, used by BOTH the app
/// (LilConfig.save) and the host (whitelist-op) so the unknown-field-preservation
/// contract lives in exactly one place.
///
/// Why not plain Codable? Encoding a `LilConfig` and writing it verbatim would
/// DROP any JSON key the struct does not declare. The v3 contract requires every
/// writer to preserve unknown fields (forward-compat with newer schema versions
/// written by a newer component). So we treat config.json as a free-form JSON
/// object and overwrite only the keys we own, leaving everything else intact.
///
/// Ownership rule (matches docs/PROTOCOL.md): a writer replaces the TOP-LEVEL
/// keys it defines; nested objects (e.g. `sleep`) are replaced WHOLE, not
/// deep-merged. That keeps the model simple and predictable — a component that
/// owns `sleep` owns all of it.
public enum ConfigMerge {

    /// The set of top-level keys the Swift `LilConfig` model owns. Any other key
    /// present in the file is preserved untouched.
    public static let ownedKeys: [String] = [
        "version",
        "defaultBrowser",
        "fallbackBrowser",
        "paletteAnchor",
        "linkBehavior",
        "ephemeralDefault",
        "sleep",
        "searchEngine",
        "hoverBar",
        "knownBrowsers",
    ]

    /// Produce the merged JSON bytes for writing: start from `existing` (the raw
    /// bytes currently on disk, or nil), overlay the owned keys computed from
    /// `config`, and serialize pretty-printed with sorted keys.
    ///
    /// Returns nil only if `config` itself cannot be encoded (never expected).
    /// If `existing` is nil or unparseable as a JSON object, the result is just
    /// the encoded config (no prior unknown fields to preserve).
    public static func mergedJSONData(existing: Data?, applying config: LilConfig) -> Data? {
        // Canonical dict for the config we want to persist.
        guard let ownedDict = jsonObject(encoding: config) else { return nil }

        // Base = whatever is already on disk (preserve its unknown keys), or {}.
        var base: [String: Any] = {
            if let existing = existing,
               let obj = try? JSONSerialization.jsonObject(with: existing),
               let dict = obj as? [String: Any] {
                return dict
            }
            return [:]
        }()

        // Overlay only the keys this model owns; leave every other key intact.
        for key in ownedKeys {
            if let value = ownedDict[key] {
                base[key] = value
            }
        }

        return serialize(base)
    }

    /// Apply a whitelist add/remove to config.json's `sleep.whitelist` and return
    /// the merged JSON bytes, preserving all other fields (including unknown
    /// ones). Domains are lowercased and deduped. `op` is "add" or "remove".
    ///
    /// The host uses this for `whitelist-op` messages. Operating on the raw JSON
    /// dict (rather than decode → mutate → save) guarantees any unknown top-level
    /// keys AND any unknown keys inside `sleep` survive the edit.
    public static func applyWhitelistOp(existing: Data?, op: String, domain: String) -> Data? {
        let host = normalizedDomain(domain)
        guard !host.isEmpty else { return nil }

        // Base object from disk (or {} for a fresh file), so we preserve unknowns.
        var base: [String: Any] = {
            if let existing = existing,
               let obj = try? JSONSerialization.jsonObject(with: existing),
               let dict = obj as? [String: Any] {
                return dict
            }
            return [:]
        }()

        // Pull the existing `sleep` object (preserving its own unknown keys), or
        // seed it from defaults so a fresh file gets a well-formed section.
        var sleepDict: [String: Any] = (base["sleep"] as? [String: Any]) ?? {
            jsonObject(encoding: SleepConfig.defaults) ?? [:]
        }()

        // Current whitelist as lowercased strings, order preserved.
        var list: [String] = (sleepDict["whitelist"] as? [Any])?
            .compactMap { $0 as? String }
            .map { $0.lowercased() } ?? []

        switch op {
        case "add":
            if !list.contains(host) { list.append(host) }
        case "remove":
            list.removeAll { $0 == host }
        default:
            return nil // unknown op — caller logs and drops
        }

        // Dedupe defensively while preserving first-seen order.
        var seen = Set<String>()
        list = list.filter { seen.insert($0).inserted }

        sleepDict["whitelist"] = list
        base["sleep"] = sleepDict

        // Ensure the file advertises at least schema v2 once we've touched it.
        if base["version"] == nil { base["version"] = 2 }

        return serialize(base)
    }

    /// Lowercase a domain and reduce it to a bare host: strips scheme, any path,
    /// and userinfo/port. "HTTPS://Example.com/foo" -> "example.com". Best-effort
    /// so a plain "example.com" passes through unchanged.
    public static func normalizedDomain(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.isEmpty { return "" }
        // Strip scheme.
        if let r = s.range(of: "://") { s = String(s[r.upperBound...]) }
        // Strip anything from the first path/query/fragment separator.
        if let idx = s.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) {
            s = String(s[..<idx])
        }
        // Strip userinfo.
        if let at = s.lastIndex(of: "@") { s = String(s[s.index(after: at)...]) }
        // Strip port.
        if let colon = s.firstIndex(of: ":") { s = String(s[..<colon]) }
        return s
    }

    // MARK: - Internals

    /// Encode an Encodable to a JSON object dict via JSONEncoder + JSONSerialization.
    private static func jsonObject<T: Encodable>(encoding value: T) -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let dict = obj as? [String: Any] else {
            return nil
        }
        return dict
    }

    /// Serialize a JSON object to pretty-printed, sorted-key bytes.
    private static func serialize(_ object: [String: Any]) -> Data? {
        try? JSONSerialization.data(
            withJSONObject: object,
            options: [.prettyPrinted, .sortedKeys]
        )
    }

    /// Atomically write `data` to `url` via a sibling tmp file + rename. Ensures
    /// the parent dir exists. Best-effort: swallows errors and cleans up the tmp.
    public static func atomicWrite(_ data: Data, to url: URL) {
        LilPaths.ensureStateDir()
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent(".config.json.tmp-\(getpid())", isDirectory: false)
        do {
            try data.write(to: tmp, options: .atomic)
            // Rename is atomic within the same directory. replaceItemAt handles
            // an existing destination; moveItem covers the fresh-file case.
            if FileManager.default.fileExists(atPath: url.path) {
                _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
            } else {
                try FileManager.default.moveItem(at: tmp, to: url)
            }
        } catch {
            try? FileManager.default.removeItem(at: tmp)
        }
    }
}
