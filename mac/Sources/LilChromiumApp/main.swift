import AppKit

// LilChromiumApp — menu-bar agent. Entry point wires up NSApplication with an
// AppDelegate. Activation policy is set to .accessory in
// applicationDidFinishLaunching so there is no Dock icon (LSUIElement in the
// bundled Info.plist also enforces this).

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
