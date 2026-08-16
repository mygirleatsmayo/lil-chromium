// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "lil-chromium",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        // Shared message types, JSON codecs, socket path helper.
        .target(
            name: "LilShared"
        ),
        // Menu-bar agent app (packaged into LilChromium.app by scripts/bundle-app.sh).
        .executableTarget(
            name: "LilChromiumApp",
            dependencies: ["LilShared"]
        ),
        // Native messaging host: Chrome <-> unix socket relay.
        .executableTarget(
            name: "lilchromium-host",
            dependencies: ["LilShared"]
        ),
        // Behavior tests for the contract: config, messages, routing, URL intent,
        // palette ranking. One target so every suite shares one fixture set.
        .testTarget(
            name: "LilChromiumTests",
            dependencies: ["LilShared", "LilChromiumApp"],
            resources: [.copy("Fixtures")]
        )
    ]
)
