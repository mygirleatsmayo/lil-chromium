extension String {
    /// The text less leading and trailing whitespace as Chrome counts it
    /// (PROTOCOL.md *URL intent*): Unicode's White_Space property, which is
    /// Chrome's `kWhitespaceUTF16` (`base/strings/whitespace_constants.h`).
    /// Mirrors `trimWhitespace` in `background.js`.
    /// verified: macOS 27.0, every scalar compared with Chrome's list —
    /// `Unicode.Scalar.Properties.isWhitespace` matches it exactly, while
    /// Foundation's `.whitespacesAndNewlines` also holds U+200B.
    public func trimmingWhitespace() -> String {
        let scalars = unicodeScalars
        guard let first = scalars.firstIndex(where: { !$0.properties.isWhitespace }),
              let last = scalars.lastIndex(where: { !$0.properties.isWhitespace })
        else { return "" }
        return String(scalars[first...last])
    }
}
