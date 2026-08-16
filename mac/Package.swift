// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "lil-chromium",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        // Shared message types, JSON codecs, socket path helper.
        .target(
            name: "LilShared",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // Menu-bar agent app (packaged into LilChromium.app by scripts/bundle-app.sh).
        .executableTarget(
            name: "LilChromiumApp",
            dependencies: ["LilShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // Native messaging host: Chrome <-> unix socket relay.
        .executableTarget(
            name: "lilchromium-host",
            dependencies: ["LilShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // Behavior tests for the contract: config, messages, routing, URL intent,
        // palette ranking. One target so every suite shares one fixture set.
        // Fixtures load from the repo-root fixtures/ directory (see Fixture.swift),
        // which the Node/MV3 suite reads too — nothing is bundled into the target.
        .testTarget(
            name: "LilChromiumTests",
            dependencies: ["LilShared", "LilChromiumApp"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
