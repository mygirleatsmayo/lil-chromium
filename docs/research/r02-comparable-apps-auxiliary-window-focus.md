# Comparable apps: opening/closing auxiliary windows without raising a main window

## Question

Do comparable macOS/Electron/Chromium apps open and close floating/auxiliary windows without raising an unrelated main window? Start from the Obsidian "Floating Notes" plugin Lucas uses; extract reusable focus principles vs mechanisms Lil Chromium cannot copy (a lil is a window of an external Chromium app, one shared macOS app identity); give diagnostic lessons for #31/#32. Prior art check: did r01 already study comparable apps?

## Conclusion

- **Confirmed:** r01 studied only Chromium/AppKit/extension APIs and field reports — no comparable-app implementations. This report is the first comparable-app pass.
- **Confirmed:** Lucas's plugin is `haotiencheng/obsidian-floating-notes` v1.3.2 (installed in his vault; community plugin id `floating-notes`). It opens an Obsidian popout (`workspace.getLeaf("window")` → same-process Electron `BrowserWindow`), grabs the undocumented `win.electronWindow` handle, and focuses it with `bw.focus()`. It **never closes the window on toggle** — it hides via `setOpacity(0)` + `setIgnoreMouseEvents(true)` — so the close-focus-restoration problem is designed out, not solved. It does zero focus-restoration bookkeeping anywhere.
- **Confirmed:** Its README documents the #32-analogous trade-off explicitly: the loopback-HTTP trigger "toggles the popout without activating the Obsidian app or raising the main window"; the `obsidian://` URI trigger "activates the Obsidian app on macOS, which briefly raises the main window."
- **Confirmed:** Every comparable non-raising mechanism (Electron `type:'panel'` → `ElectronNSPanel` with `NSWindowStyleMaskNonactivatingPanel`; Chromium Glic floating window → `SetActivationIndependence(true)`; Floating Notes' hide-instead-of-close) works **inside the process that owns the window**. None is reachable through the `chrome.windows` extension API, which on Mac couples focused show to `[NSApp activateIgnoringOtherApps:YES]` (r01).
- **Confirmed:** No comparable app implements "restore the MRU external app when the auxiliary window closes." Electron/Obsidian do no predecessor tracking; they accept the platform default the ADR-0004 rejects. #31's requirement is bespoke.
- **Unverified:** Arc Little Arc — only a vendor support article exists (closed source, sunset); no implementation evidence.

## Evidence

### Q1 — r01 scope

**Confirmed.** r01's four questions are all Chromium/AppKit/extension-API semantics; all 22 sources are Chromium source, Apple docs, Chrome extension docs, plus 4 field-report links (SO ×2, OpenCLI, alt-tab-macos/Wink). No app-implementation study. The hunches doc is lil-chromium code-reading plus hypotheses, explicitly "await research worker report" (`docs/research/r01-chromium-macos-focus-session-restore.md`; `docs/scratch/lil-chromium-focus-bug-hunches.md`).

### Q2 — Floating Notes (`haotiencheng/obsidian-floating-notes`)

Identity **confirmed** by installed manifest `~/Obsidian/mygirleatsmayo_vault/.obsidian/plugins/floating-notes/manifest.json` (id `floating-notes`, v1.3.2, authorUrl github.com/haotiencheng) matching the community plugin page. Source: `main.ts` (single file, repo main).

- **Creation (confirmed).** `toggleCapture()` calls `this.app.workspace.getLeaf("window")` — Obsidian's popout API (`obsidian.d.ts`: `WorkspaceWindow`, "Migrates this leaf to a new popout window… desktop app only"). Obsidian creates the popout Electron `BrowserWindow` itself; the plugin adopts it on the `window-open` event.
- **Window handle (confirmed).** `(win.win as PopoutWindow).electronWindow` — an undocumented Obsidian property exposing the Electron `BrowserWindow`. Plugin then calls `setSkipTaskbar(true)`, `setAlwaysOnTop(true, "floating")`, `setBounds`, `setOpacity`, `setIgnoreMouseEvents(false)`, and `bw.focus()` (only when opening via toggle; a session-restored popout is adopted with `focus: false`).
- **App/main-window activation (confirmed as author-documented design).** README trigger table: HTTP `127.0.0.1:51234/toggle` = no app activation, no main-window raise; `obsidian://floating-notes` URI = activates app, "briefly raises the main window." Plugin code contains no activation calls; the difference is entirely the trigger path (NSWorkspace URI-open activates; loopback HTTP does not). What happens inside `bw.focus()`: Electron `NativeWindowMac::Focus(true)` on a non-panel window runs `[NSApp activateIgnoringOtherApps:NO]` then `makeKeyAndOrderFront:` (`native_window_mac.mm` L444–L458) — a non-forcing activation request, unlike `Show()`'s `activateIgnoringOtherApps:YES` (L465–L488).
- **Focus on close (confirmed).** None. `window-close` only nulls plugin state. The normal flow never closes: "hide" = `setOpacity(0)` + `setIgnoreMouseEvents(true)` + `setSkipTaskbar(true)` — the window stays ordered-in, so AppKit performs no key-window reassignment at all. "Show" reverses it and calls `bw.focus()`.
- **Electron/Obsidian-supplied vs plugin code (confirmed).** Popout creation and startup restore of popouts: Obsidian (plugin comment: "Obsidian restores popout windows from the saved layout on startup, before plugins load. Adopt that window instead of opening a second one."). `focus`/`setAlwaysOnTop`/`setOpacity`/`setIgnoreMouseEvents`: Electron. Toggle state machine, HTTP server, hide-via-opacity, bounds persistence, Escape-to-hide: plugin.

### Q3 — additional analogues

1. **Electron `BrowserWindow` (confirmed, source main).** `Focus(true)`/`Show()` activate the app for ordinary windows but **skip activation for panels** — code comment: "If we're a panel window, we do not want to activate the app, which enables Electron-apps to build Spotlight-like experiences" (`native_window_mac.mm` L449–L453, L484–L487). `type: 'panel'` (L281) yields `ElectronNSPanel`, whose `styleMask` getter ORs `NSWindowStyleMaskNonactivatingPanel` and whose collection behavior adds `CanJoinAllSpaces | FullScreenAuxiliary` (`electron_ns_panel.mm`). `ShowInactive()` = `widget()->ShowInactive()` + `orderFrontRegardless`, no activation, no key (L490–L506). Docs: `win.show()` "Shows and gives focus"; `win.showInactive()` "Shows the window but doesn't focus"; `setAlwaysOnTop` level `floating` (docs/api/browser-window.md).
2. **macOS NSPanel (confirmed, Apple doc).** "A special kind of window that typically performs a function that is auxiliary to the main window" (developer.apple.com/documentation/appkit/nspanel). The non-activating style mask is panel-reserved; Electron reaches it via the runtime-OR workaround above.
3. **Chromium Glic floating window (confirmed, source main).** Chrome's own floating assistant: `GetGlicWidget()->SetActivationIndependence(true); SetVisibleOnAllWorkspaces(true); SetCanAppearInExistingFullscreenSpaces(true);` (`chrome/browser/glic/widget/glic_floating_ui.cc` L163–L167). The bridge then **skips** `[NSApp activateIgnoringOtherApps:YES]` on show-and-activate when the window has `activationIndependence` (`native_widget_ns_window_bridge.mm` L1044–L1051) — Chromium's in-tree mechanism for exactly the #32 problem. (`omnibox_everywhere_ui_manager.cc` is the only other in-tree user.)
4. **Arc Little Arc (unverified implementation).** Vendor support article only: a small window that opens links from other apps and auto-archives (resources.arc.net/hc/en-us/articles/19235387524503). Closed source, product sunset; no primary implementation evidence. Not actionable.

### Q4 — reusable principles vs non-copyable mechanisms

Reusable (confirmed by the sources above):

1. **Never route open/toggle through an app-activating path.** Floating Notes chose HTTP over `obsidian://` for exactly #32's symptom. In Lil Chromium, r01 confirms the extension's `windows.create({focused:true})` is the activation source on the happy path.
2. **Prefer hide/show of a persistent window over close/recreate** — removes close-focus restoration and session-restore edge cases wholesale.
3. **Non-activating panel semantics + `floating` level** are the canonical macOS pattern for auxiliary UI (Apple NSPanel; Electron panel; Glic).
4. **Adopt restored windows instead of opening duplicates** (Floating Notes' `onLayoutReady` adoption).

Not copyable (a lil is a window of an external Chromium app; Lil Chromium holds no `BrowserWindow`/NSWindow handle):

- `bw.focus()`/`showInactive()`/`setAlwaysOnTop`/`setOpacity`/`setIgnoreMouseEvents` — no extension-API equivalents; `windows.update({focused:false})` is `NOTIMPLEMENTED()` on Mac (r01 S2); focused create always force-activates (r01 S9).
- Panel style masks / `activationIndependence` — set at window construction inside Chromium; not reachable for extension popups (`TYPE_APP_POPUP`).
- The hide-instead-of-close trick — needs window-opacity and click-through control the extension API lacks.

### Q5 — diagnostic lessons for #31/#32

- **#32:** the sibling-raise is the documented Chromium focused-show path — activate app first, then `makeKeyAndOrderFront:`, and AppKit's default activation raises the previous main/key window (r01 Q2, confirmed). Every comparable app avoids this by *never activating*, not by fixing the raise after the fact. Diagnostic: catch which activation fires at open (host fallback vs Chromium focused-create — hunches doc verifies the relay path makes zero activate calls), and run the AC's same-Helium-version v0.3↔v0.4 differential, since no comparable app suggests any post-activation fix exists.
- **#31:** no comparable app tracks a cross-app predecessor or restores an external app on auxiliary-window close; Electron/Obsidian accept the platform default that ADR-0004 explicitly rejects. So the wrong-predecessor hypothesis (hunches Hunch 1: stale `focused:true` from `getAll` overriding the app-captured external app) remains the prime suspect — there is no copyable restore mechanism to find. Separately, Floating Notes shows the radical fallback: if close semantics stay intractable, a hide-based lifecycle designs the problem out (relevant to Lil Nap, speculative as a #31 fix).

## Gaps

- Whether `activateIgnoringOtherApps:NO` in Electron's `Focus(true)` is what lets Floating Notes focus its popout while another app stays frontmost (author-reported behavior; mechanism identified, not live-verified). Does not block #31/#32 diagnosis.
- How Obsidian's own popout-creation code shows/focuses the window (closed source). Plugin-level behavior fully covered regardless.
- Arc Little Arc internals: no primary evidence exists. Not blocking.

## Sources

| Locator | Retrieved | Freshness |
| --- | --- | --- |
| docs/research/r01-chromium-macos-focus-session-restore.md (repo) | 2026-08-26 | fresh |
| docs/scratch/lil-chromium-focus-bug-hunches.md (repo) | 2026-08-26 | fresh |
| CONTEXT.md, docs/adr/0004-follow-ordinary-macos-focus-history.md (repo) | 2026-08-26 | fresh |
| gh issues #26, #31, #32 (this repo) | 2026-08-26 | fresh |
| ~/Obsidian/mygirleatsmayo_vault/.obsidian/plugins/floating-notes/manifest.json (plugin dir listing + manifest only) | 2026-08-26 | fresh |
| https://github.com/haotiencheng/obsidian-floating-notes (main.ts, README.md, manifest.json) | 2026-08-26 | fresh |
| https://community.obsidian.md/plugins/floating-notes | 2026-08-26 | fresh |
| https://github.com/electron/electron/blob/main/shell/browser/native_window_mac.mm | 2026-08-26 | fresh |
| https://github.com/electron/electron/blob/main/shell/browser/ui/cocoa/electron_ns_panel.mm (+ .h) | 2026-08-26 | fresh |
| https://github.com/electron/electron/blob/main/docs/api/browser-window.md | 2026-08-26 | fresh |
| https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/remote_cocoa/app_shim/native_widget_ns_window_bridge.mm | 2026-08-26 | fresh |
| https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/glic/widget/glic_floating_ui.cc | 2026-08-26 | fresh |
| https://github.com/obsidianmd/obsidian-api obsidian.d.ts (WorkspaceWindow, getLeaf, popout) | 2026-08-26 | fresh |
| https://developer.apple.com/documentation/appkit/nspanel | 2026-08-26 | fresh |
| https://resources.arc.net/hc/en-us/articles/19235387524503-Little-Arc-Quick-Lookups-Instant-Triaging | 2026-08-26 | fresh |
