import AppKit

/// The application's one conventional menu bar.
///
/// Lil Chromium is an `.accessory` app, so macOS never *draws* this menu bar.
/// It is still the root fix for two things the app cannot get any other way:
/// NSApplication routes ⌘-key events through `NSApp.mainMenu` inside
/// `sendEvent(_:)`, so without a main menu there is no ⌘, anywhere and no
/// ⌘Z/⌘X/⌘C/⌘V/⌘A in any native text field — including the palette's.
///
/// verified: with `.accessory` policy and a `.nonactivatingPanel` as key window,
/// `NSApp.sendEvent` fires the main menu's ⌘, item and delivers ⌘V to the
/// panel's field editor (probed on macOS 27, Xcode-beta toolchain).
///
/// The status-item menu is a separate, deliberately duplicated surface: it is
/// how the app is reached when no window is up.
@MainActor
enum MainMenu {

    /// The product name as the domain glossary spells it.
    private static let appName = "Lil Chromium"

    /// Build the menu bar. `target` receives the application-level actions;
    /// every editing command is nil-targeted so it resolves against whatever
    /// text field currently holds first responder.
    static func make(target: AppDelegate) -> NSMenu {
        let mainMenu = NSMenu()
        mainMenu.addItem(submenu(applicationMenu(target: target)))
        mainMenu.addItem(submenu(editMenu()))
        mainMenu.addItem(submenu(windowMenu()))
        return mainMenu
    }

    // MARK: - Menus

    private static func applicationMenu(target: AppDelegate) -> NSMenu {
        let menu = NSMenu(title: appName)
        menu.addItem(item("About \(appName)",
                          #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
        menu.addItem(.separator())
        // ⌘, is the reason this menu bar exists — it must live here, not only on
        // the status item, for the standard shortcut to work.
        menu.addItem(item("Settings…", #selector(AppDelegate.showSettings),
                          key: ",", target: target))
        menu.addItem(item("Set as Default Browser…", #selector(AppDelegate.setAsDefaultBrowser),
                          target: target))
        menu.addItem(.separator())
        menu.addItem(item("Quit \(appName)", #selector(AppDelegate.quit),
                          key: "q", target: target))
        return menu
    }

    /// Standard Edit commands. All nil-targeted: NSApplication walks the key
    /// window's responder chain, which lands on the field editor of whichever
    /// NSTextField is being edited (palette input or a Settings field).
    private static func editMenu() -> NSMenu {
        let menu = NSMenu(title: "Edit")
        // undo:/redo: have no Swift declaration to point #selector at.
        menu.addItem(item("Undo", Selector(("undo:")), key: "z"))
        menu.addItem(item("Redo", Selector(("redo:")), key: "z", modifiers: [.command, .shift]))
        menu.addItem(.separator())
        menu.addItem(item("Cut", #selector(NSText.cut(_:)), key: "x"))
        menu.addItem(item("Copy", #selector(NSText.copy(_:)), key: "c"))
        menu.addItem(item("Paste", #selector(NSText.paste(_:)), key: "v"))
        menu.addItem(item("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)),
                          key: "v", modifiers: [.command, .option, .shift]))
        menu.addItem(item("Delete", #selector(NSText.delete(_:))))
        menu.addItem(item("Select All", #selector(NSText.selectAll(_:)), key: "a"))
        return menu
    }

    /// Window commands for the Settings window. `NSApp.windowsMenu` is
    /// deliberately NOT set: an agent app has no meaningful window list, and the
    /// palette is a borderless panel that should never be listed.
    private static func windowMenu() -> NSMenu {
        let menu = NSMenu(title: "Window")
        menu.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), key: "m"))
        menu.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Close", #selector(NSWindow.performClose(_:)), key: "w"))
        return menu
    }

    // MARK: - Builders

    /// A top-level menu-bar entry. The bar shows the submenu's title; the
    /// carrier item's own title is ignored.
    private static func submenu(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem()
        item.submenu = menu
        return item
    }

    /// One menu item.
    private static func item(
        _ title: String,
        _ action: Selector,
        key: String = "",
        modifiers: NSEvent.ModifierFlags = [.command],
        target: AnyObject? = nil
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        return item
    }
}
