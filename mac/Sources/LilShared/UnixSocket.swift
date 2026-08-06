import Foundation

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// Helpers for working with AF_UNIX sockaddr_un in Swift without tripping
/// exclusive-access rules. Building the address once and handing callers a raw
/// sockaddr pointer keeps the fragile pointer-rebinding in a single place.
public enum UnixSocket {

    /// Maximum bytes usable for the path (sun_path is a fixed C array, 104 on
    /// Darwin). We compute it from the type so it is correct on any platform.
    public static var pathCapacity: Int {
        // sockaddr_un.sun_path is imported as a homogeneous tuple; its size is
        // the capacity in bytes.
        MemoryLayout<sockaddr_un>.size - MemoryLayout<sa_family_t>.size
            - MemoryLayout<UInt8>.size  // sun_len byte on BSD/Darwin
    }

    /// Build a sockaddr_un for `path`. Returns nil if the path is too long.
    /// The returned value is copied by the caller before use.
    public static func makeAddress(path: String) -> sockaddr_un? {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        let bytes = Array(path.utf8)
        // Need room for the trailing NUL.
        let cap = MemoryLayout.size(ofValue: addr.sun_path)
        if bytes.count >= cap { return nil }

        withUnsafeMutableBytes(of: &addr.sun_path) { rawBuf in
            for (i, b) in bytes.enumerated() {
                rawBuf[i] = b
            }
            rawBuf[bytes.count] = 0 // NUL-terminate
        }
        return addr
    }

    /// Call `body` with a `sockaddr` pointer and length for the given address.
    /// Keeps the rebinding localized and exclusivity-safe.
    public static func withSockaddr<R>(
        _ addr: inout sockaddr_un,
        _ body: (UnsafePointer<sockaddr>, socklen_t) -> R
    ) -> R {
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        return withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sp in
                body(sp, len)
            }
        }
    }
}
