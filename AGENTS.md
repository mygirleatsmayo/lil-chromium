# AGENTS.md

lil-chromium: a macOS menu-bar agent (the system default browser) that opens links as **lils** — ephemeral popup windows of the user's real Chromium browser. Three components, one contract: `mac/` (Swift package: LilChromiumApp agent + lilchromium-host relay), `extension/` (MV3, loaded unpacked, no build step), `docs/PROTOCOL.md` (the contract).

- Read `docs/PROTOCOL.md` before touching messages, `config.json`, relay sockets, browser slugs, routing order, or the pinned IDs (extension ID, host name, bundle ID). A contract change lands in all three components or none.
- Annotate AppKit-touching classes `@MainActor`. The Swift 6.2 toolchain (Xcode beta) makes isolation violations hard errors even in Swift 5 mode.
- Mark API/OS behavior you have confirmed on a real system with a `verified:` comment; keep existing ones accurate when changing the code they describe.
- Validate with `make app` (release build; there are no test targets). `make install` goes further: it replaces the live app in /Applications and rewrites every browser's native-host manifest.
