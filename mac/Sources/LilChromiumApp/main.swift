import AppKit

// LilChromiumApp — menu-bar agent. Entry point wires up NSApplication with an
// AppDelegate. Activation policy is set to .accessory in
// applicationDidFinishLaunching so there is no Dock icon (LSUIElement in the
// bundled Info.plist also enforces this).

// Top-level code is nonisolated, but AppDelegate is @MainActor. main.swift
// always runs on the main thread, so assuming isolation here is safe.
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}
