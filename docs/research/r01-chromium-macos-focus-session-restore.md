# Chromium-on-macOS focus semantics and extension-page session restore

## Question

Diagnosing focus regressions in lil chromium (Swift default-browser agent + MV3 extension + native-messaging host opening Helium popup “lils”).

1. When Chromium is not frontmost on macOS, can `chrome.windows.getAll` / `getLastFocused` still report a window `focused: true`? Exact semantics, version differences, known crbugs. Is `windows.onFocusChanged` → `WINDOW_ID_NONE` reliably fired when the app deactivates, including when another app was activated programmatically?

2. With Chromium inactive, does `chrome.windows.create({focused:true})` and/or `chrome.windows.update(id, {focused:true})` activate the whole app in a way that can raise other Chromium windows — especially multi-display with “Displays have separate Spaces”? Known ordering (previous key window before the new window)? Documented workarounds?

3. Rules for `NSRunningApplication.activate(options:)` from a faceless background process (LSUIElement/agent, spawned as a native-messaging host) activating a third app while the browser is frontmost. Does `.activateIgnoringOtherApps` still work; what changed with cooperative activation / `yieldActivation(to:)` / `activate(from:options:)`; failure modes where `activate()` returns true but nothing happens; TCC/permission dependency.

4. When a `chrome-extension://` page lives in `type:"popup"`: under which conditions does Chromium restore it after restart as a tab in a normal window (“continue where you left off”, crash restore, Cmd+Shift+T)? What happens to open popup windows and their extension pages when the extension is removed and re-added unpacked (same pinned ID, different path)?

## Conclusion

Act on (1)–(3) from Chromium `main` + Apple docs. (4)’s “slept page wakes as a tab” hook is not identified.

- **Q1 — confirmed:** `Window.focused` is Mac key-window (`IsActive()` → `IsWindowKey()`), not last-used Chrome window. `getLastFocused` returns the top of activation order even when nothing is key; that object can have `focused: false`. After AppKit has no `keyWindow`, `getAll` should show no `focused: true`. Mac `onFocusChanged(WINDOW_ID_NONE)` is resign-key → one run-loop delay → `keyWindow == nil`. Same path for programmatic activation of another app; not same-JS-turn. **likely:** a `getAll` in that delay can still see the old key window as focused. **unverified:** lasting `focused: true` after full deactivation; Helium fork divergence; current Space-switch miss (old crbugs only).

- **Q2 — confirmed:** `create({focused:true})` (default true) and `update({focused:true})` call `[NSApp activateIgnoringOtherApps:YES]` then `makeKeyAndOrderFront`. AppKit raises the previous main/key window first — the usual other-display normal window. `focused:false` on another screen uses `orderFrontKeepWindowKeyState` and Chromium comments that this space-switches. `update({focused:false})` hits `NativeWidgetMac::Deactivate()` = `NOTIMPLEMENTED()`. **likely:** symptom (a) is this ordering, not a second create. Dock `FocusWindowSetOnCurrentSpace` is a different path.

- **Q3 — confirmed:** macOS 14+ activation is a request. Only the active app can `yieldActivation`. A native-messaging LSUIElement is not active (the browser is) and cannot yield. `activate(from:options:)` true means the request was allowed, not that the app is frontmost. `.activateIgnoringOtherApps` is deprecated as of 14. Chromium still calls it on focused show. Apple activate pages do not mention TCC. **likely:** true-but-nothing-happens is the cooperative contract; no Accessibility TCC for this API. **unverified:** whether deprecated `ignoringOtherApps` still force-activates from a Chromium-spawned agent on macOS 15/26.

- **Q4 — confirmed:** extension `windows.create({type:"popup"})` → untrusted `TYPE_APP_POPUP`, excluded from session restore. Startup/crash restore will not bring that window back as a popup. Cmd+Shift+T: window entry can restore type; tab entry lands in the current (usually normal) window. Unload closes `chrome-extension://<id>/` tabs, or navigates the last tab to NTP. Unpacked reload is an update. **likely:** remove/re-add does not resurrect old documents. **unverified:** a discarded/frozen extension page relocating into a normal window.

Bug triad: (a) app-activate-then-key raises the previous main/key window. (b) predecessor from `focused:true` at open is wrong if sampled in the stale-key gap or via last-focused; close leaves Helium frontmost; the helper cannot cooperatively activate the real predecessor. (c) extension popups are invisible to session restore; a tab in a normal window is a later open/restore into `TYPE_NORMAL`, not a popup→tab mapper.

## Evidence

### Q1 — focused flag and `WINDOW_ID_NONE`

- **confirmed.** `chrome.windows.Window.focused` is `window()->IsActive()` ([S1](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/browser_extension_window_controller.cc)). On Mac, `NativeWidgetMac::IsActive()` is `ns_window_host_->IsWindowKey()` ([S2](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/views/widget/native_widget_mac.mm)).
- **confirmed.** `getLastFocused` walks `ForEachCurrentBrowserWindowInterfaceOrderedByActivation` and returns the first visible window ([S3](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/tabs_api.cc)). The returned object still sets `focused` from `IsActive()`. Background Chromium: call can succeed with `focused === false`.
- **confirmed.** Docs: `getLastFocused` is “most recently focused — typically the window 'on top'.” `onFocusChanged` returns `WINDOW_ID_NONE` if all Chrome windows lost focus. Linux-only note: some WMs always emit `WINDOW_ID_NONE` immediately before a Chrome-to-Chrome switch ([S4](https://developer.chrome.com/docs/extensions/reference/api/windows), [S5](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/extensions/api/windows.json)).
- **confirmed.** Intended: once no NSWindow is key, no window is `focused: true`.
- **confirmed.** Mac `WindowsEventRouter` observes `KeyWindowNotifier`. `OnNoKeyWindow()` → `OnActiveWindowChanged(nullptr)` → `onFocusChanged` with `WINDOW_ID_NONE` (−1). Duplicate IDs suppressed ([S6](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/windows_event_router.cc), [S7](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/mac/key_window_notifier.h)).
- **confirmed.** `AppController` listens for `NSWindowDidResignKeyNotification`, then `performSelector:checkForAnyKeyWindows afterDelay:0.0`. If `[NSApp keyWindow]` is still nil, `NotifyNoKeyWindow()`. Delay exists because AppKit has not assigned the next key window at resign-key time ([S8](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/app_controller_mac.mm)).
- **likely.** Programmatic activation of another app uses the same resign-key path. `WINDOW_ID_NONE` fires after that delay, not in the same JS turn as the other process’s `activate()`. Sampling `getAll` in the gap can still see `focused: true`.
- **confirmed.** Inverse stale state: if `makeKeyAndOrderFront:` runs before `[NSApp activateIgnoringOtherApps:YES]` while inactive, AppKit skips `NSWindowDidBecomeKeyNotification` and `Widget::IsActive()` stays false ([S9](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/remote_cocoa/app_shim/native_widget_ns_window_bridge.mm)). Chromium source does not document lasting `focused: true` after full deactivation.
- **confirmed.** CL [aeaa134](https://chromium.googlesource.com/chromium/src/+/aeaa1349537130b7083ad0af23d9d90db0dc8147) made de-focus always emit `WINDOW_ID_NONE`, then focus-gained.
- **likely (stale field data).** Space-switch / swipe away from fullscreen Chrome reported not to fire `onFocusChanged` ([SO 39259542](https://stackoverflow.com/questions/39259542/chrome-extension-listener-to-detect-switching-desktops-on-os-x), crbug 516740 / 391471). Windows alt-tab to another app reported similar until minimize ([SO 57504206](https://stackoverflow.com/questions/57504206/how-to-check-if-non-chrome-window-is-focused-chrome-extensions-api)). Dates 2016–2019; not a current Mac source walk.

### Q2 — focused create raising siblings

- **confirmed.** Default `focused` is true if omitted. True → `Show()`; false → `ShowInactive()` ([S3](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/tabs_api.cc)).
- **confirmed.** `Show()` / `Activate()` → `kShowAndActivateWindow`. `SetVisibilityState`: (1) `[NSApp activateIgnoringOtherApps:YES]` first unless `activationIndependence`; (2) `[window_ makeKeyAndOrderFront:nil]`. Reverse order while inactive skips become-key ([S9](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/remote_cocoa/app_shim/native_widget_ns_window_bridge.mm)).
- **confirmed.** `windows.update(id, {focused:true})` → `Activate()` → same path ([S3](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/tabs_api.cc), [S2](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/views/widget/native_widget_mac.mm)).
- **confirmed.** AppKit default activation brings only main and key windows forward. `activateAllWindows` is the opt-in to raise all ([S10](https://developer.apple.com/documentation/appkit/nsapplication/activationoptions)). Whole-app activate while Chromium is inactive is expected to raise the previous main/key window before the new popup becomes key.
- **likely.** That previous window is often the normal browser on another display. Symptom (a) matches this ordering.
- **confirmed.** Dock reopen `applicationShouldHandleReopen:` calls `FocusWindowSetOnCurrentSpace`: `orderFront:` every matching `onActiveSpace` window, then `makeKeyAndOrderFront` + `activateIgnoringOtherApps`. Without the space filter they “jump spaces haphazardly”; `isOnActiveSpace` during a dock-triggered space switch can describe the previous space (crbug 41104339 / 309656) ([S8](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/app_controller_mac.mm)). This is not the `windows.create` path.
- **confirmed.** `isOnActiveSpace` is true iff the window is on “the currently active space.” Docs do not spell out per-display Spaces ([S11](https://developer.apple.com/documentation/appkit/nswindow/isonactivespace)).
- **likely.** With “Displays have separate Spaces,” each display has a current space, so `isOnActiveSpace` can be true for other-display windows.
- **confirmed.** Cross-display fullscreen: AppKit can make a different window on the previous space key (crbug 40229685, 40247797) ([S9](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/remote_cocoa/app_shim/native_widget_ns_window_bridge.mm)).
- **confirmed.** Unfocused create on another screen than `NSApp.mainWindow` while main is key: `orderFrontKeepWindowKeyState`; Chromium comments this triggers a space switch ([S9](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/remote_cocoa/app_shim/native_widget_ns_window_bridge.mm)).
- **confirmed.** `NativeWidgetMac::Deactivate()` is `NOTIMPLEMENTED()` ([S2](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/views/widget/native_widget_mac.mm)). `update({focused:false})` has no native un-focus on Mac.
- **confirmed (field reports).** Extensions report macOS ignoring `focused: false` on create ([OpenCLI #739](https://github.com/jackwener/OpenCLI/issues/739), [SO 21225477](https://stackoverflow.com/questions/21225477/chrome-extension-create-window-focused-property-not-working)). Tried workarounds: create then `update({focused:false})` (flash); create minimized; reuse a window. Sequoia vs later macOS anecdote is not a Chromium CL.

### Q3 — cooperative activation from a faceless host

- **confirmed.** Activation is a request. `NSApp.activate()` does not guarantee activation. Handoff: active app `yieldActivation(to:)` then target `activate()`. Only the active app can influence activation context. `NSWorkspace` does this when opening URLs/apps ([S12](https://developer.apple.com/documentation/appkit/passing-control-from-one-app-to-another-with-cooperative-activation)).
- **confirmed.** `activate(from:options:)` (macOS 14+): does not guarantee activation. Return true if the request is allowed. Other app should `yieldActivation(to:)` first ([S13](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(from:options:))).
- **confirmed.** Older `activate(options:)`: false if quit or not a type that can be activated ([S14](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(options:))). Wording predates cooperative activation.
- **confirmed.** `.activateIgnoringOtherApps` deprecated macOS 10.6–14.0. Without it, activate only if no currently active app; with it, regardless ([S15](https://developer.apple.com/documentation/appkit/nsapplication/activationoptions/activateignoringotherapps), [S10](https://developer.apple.com/documentation/appkit/nsapplication/activationoptions)).
- **likely.** SDK `API_DEPRECATED("ignoringOtherApps is deprecated in macOS 14 and will have no effect.")` quoted in [Wink AGENTS.md](https://github.com/xrf9268-hue/Wink/blob/main/AGENTS.md) and [alt-tab-macos #2620](https://github.com/lwouis/alt-tab-macos/pull/2620) (2023: still appeared to work in Sonoma betas). Apple HTML scraped here says Deprecated only, not “no effect.”
- **confirmed.** Chromium still calls `[NSApp activateIgnoringOtherApps:YES]` on focused show ([S9](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/remote_cocoa/app_shim/native_widget_ns_window_bridge.mm)).
- **confirmed (rules applied).** Native-messaging host is not the active app. It cannot `yieldActivation`. `target.activate()` may be refused. `activate(from: browser)` still documents that the other app should have yielded.
- **likely.** True with no frontmost change is allowed-request ≠ granted activation ([S13](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(from:options:)), [S12](https://developer.apple.com/documentation/appkit/passing-control-from-one-app-to-another-with-cooperative-activation)). Also false for `.prohibited` / some agents ([S14](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(options:))).
- **confirmed (absence).** Apple `activate` / `yieldActivation` pages do not mention Accessibility, Automation, or TCC. **likely:** this API is not gated on those rights. AX raise/focus is a different surface.

### Q4 — extension popup restore and unload

- **confirmed.** Extension `create({type:"popup"})` sets `TYPE_APP_POPUP`, `app_name` from extension id, `is_trusted_source = false`. API still reports `type: "popup"` ([S3](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/tabs_api.cc), [S16](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/browser_extension_window_controller.cc)).
- **confirmed.** `SessionService` restores only `TYPE_NORMAL` and `TYPE_POPUP` (website popups). `TYPE_APP` / `TYPE_APP_POPUP` go to `AppSessionService` ([S17](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/sessions/session_service.cc)).
- **confirmed.** Untrusted `TYPE_APP` / `TYPE_APP_POPUP` are not tracked: “Never track app popup windows that do not have a trusted source” ([S18](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/sessions/session_service_base.cc)).
- **likely.** “Continue where you left off” and crash restore do not restore an extension popup window as a popup.
- **confirmed.** Tracked `TYPE_APP_POPUP` would restore via `CreateForAppPopup`, still a popup, not a tab ([S19](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/sessions/session_restore.cc)).
- **confirmed.** Cmd+Shift+T (`TabRestoreService`) stores `window_type` on window close ([S20](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/sessions/core/tab_restore_service_helper.cc)). Window entry can recreate type; tab entry goes to the current browser (usually `TYPE_NORMAL`).
- **confirmed.** `OnExtensionUnloaded` (except crash/`TERMINATE`) closes `chrome-extension://<id>/` tabs. Last tab in a window is navigated to NTP so the window stays up ([S21](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/extension_browser_window_helper.cc), [crbug 794472](https://chromium.googlesource.com/chromium/src/+/4d546d6ecc0e621a0d08f804a9e25c4427055740)).
- **confirmed.** Unpacked reload is an update (`onInstalled` reason `"update"`), including `chrome.runtime.reload()` ([S22](https://developer.chrome.com/docs/extensions/reference/api/runtime)).
- **likely.** Remove/re-add unpacked: in-memory extension pages do not survive. Same pinned ID does not resurrect the old document. New loads of `chrome-extension://<id>/` work after re-add. Content-script orphaning applies to content scripts in web pages, not closed extension pages ([SO 53939205](https://stackoverflow.com/questions/53939205/how-to-avoid-extension-context-invalidated-errors-when-messaging-after-an-exte)).

## Gaps

Does not block acting on (a)/(b). Blocks a precise root cause for (c)’s “wake as tab” path.

- No live Mac / Helium experiment. All Mac claims are Chromium `main` + Apple docs.
- No current crbug that `getAll` keeps `focused: true` after Chromium has fully deactivated. Helium fork not compared to `main`.
- `IsWindowKey()` implementation in the current remote_cocoa host was not fetched (live `isKeyWindow` vs notification-cached). Race in Q1 depends on that.
- Whether deprecated `ignoringOtherApps` still force-activates from an LSUIElement child of Chromium on macOS 15/26: not in Apple HTML. SkyLight `_SLPSSetFrontProcessWithOptions` is third-party, not Apple-supported.
- Parameter wording on `activate(from:)` (“the application to activate” vs Swift `from:`) is ambiguous in Apple’s page; not resolved.
- No Chromium source found that relocates a discarded/frozen `chrome-extension://` popup document into a `TYPE_NORMAL` window. Plausible unproven: later `tabs.create` / last normal window; Cmd+Shift+T on a tab entry; NTP husk after unload.

## Sources

| ID | Locator | Retrieved | Freshness |
| --- | --- | --- | --- |
| S1 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/browser_extension_window_controller.cc | 2026-08-24 | fresh |
| S2 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/views/widget/native_widget_mac.mm | 2026-08-24 | fresh |
| S3 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/tabs_api.cc | 2026-08-24 | fresh |
| S4 | https://developer.chrome.com/docs/extensions/reference/api/windows | 2026-08-24 | fresh |
| S5 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/extensions/api/windows.json | 2026-08-24 | fresh |
| S6 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tabs/windows_event_router.cc | 2026-08-24 | fresh |
| S7 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/mac/key_window_notifier.h | 2026-08-24 | fresh |
| S8 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/app_controller_mac.mm | 2026-08-24 | fresh |
| S9 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/remote_cocoa/app_shim/native_widget_ns_window_bridge.mm | 2026-08-24 | fresh |
| S10 | https://developer.apple.com/documentation/appkit/nsapplication/activationoptions | 2026-08-24 | fresh |
| S11 | https://developer.apple.com/documentation/appkit/nswindow/isonactivespace | 2026-08-24 | fresh |
| S12 | https://developer.apple.com/documentation/appkit/passing-control-from-one-app-to-another-with-cooperative-activation | 2026-08-24 | fresh |
| S13 | https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(from:options:) | 2026-08-24 | fresh |
| S14 | https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(options:) | 2026-08-24 | fresh |
| S15 | https://developer.apple.com/documentation/appkit/nsapplication/activationoptions/activateignoringotherapps | 2026-08-24 | fresh |
| S16 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/browser_extension_window_controller.cc (`GetTabsWindowType`) | 2026-08-24 | fresh |
| S17 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/sessions/session_service.cc | 2026-08-24 | fresh |
| S18 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/sessions/session_service_base.cc | 2026-08-24 | fresh |
| S19 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/sessions/session_restore.cc | 2026-08-24 | fresh |
| S20 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/sessions/core/tab_restore_service_helper.cc | 2026-08-24 | fresh |
| S21 | https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/extension_browser_window_helper.cc | 2026-08-24 | fresh |
| S22 | https://developer.chrome.com/docs/extensions/reference/api/runtime | 2026-08-24 | fresh |
| — | https://chromium.googlesource.com/chromium/src/+/aeaa1349537130b7083ad0af23d9d90db0dc8147 | 2026-08-24 | fresh |
| — | https://chromium.googlesource.com/chromium/src/+/4d546d6ecc0e621a0d08f804a9e25c4427055740 (crbug 794472) | 2026-08-24 | fresh |
| — | `cli-anything-exa search` (focus / activation / session restore queries, n=5–8) | 2026-08-24 | fresh |
| — | https://github.com/jackwener/OpenCLI/issues/739 | 2026-08-24 | fresh |
| — | https://github.com/lwouis/alt-tab-macos/pull/2620 | 2026-08-24 | fresh |
| — | https://github.com/xrf9268-hue/Wink/blob/main/AGENTS.md | 2026-08-24 | fresh |
