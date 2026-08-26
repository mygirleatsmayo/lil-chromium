# macOS auxiliary-window focus behavior: real-world comparables and mechanisms

## Question

How do successful macOS apps implement auxiliary/floating windows such that (1) opening and focusing the auxiliary window from another app does not raise unrelated main or sibling windows of the owning app, including across displays, and (2) closing the focused auxiliary window follows ordinary macOS app/window order — it does not foreground the owner's main window, a sibling auxiliary window, or an earlier origin app? Which real apps/open implementations demonstrate these behaviors (Obsidian Floating Notes is one observed example, not necessarily representative), what mechanisms produce them, what semantics/tradeoffs each mechanism carries, and which are applicable to Lil Chromium's current architecture (a lil is a Chromium `type:"popup"` window owned by the user's external browser, driven by an MV3 extension plus a Swift default-browser agent/native host)? Serves issues #31 (restore ordinary focus history on close) and #32 (open only the requested lil without raising siblings).

## Conclusion

- **No comparable achieves both behaviors with ordinary semantics while the auxiliary window shares one app identity with the owner's main windows.** Every observed solution changes either the window's *identity* (separate app) or its *semantics* (panel / hide-show / floating level). Evidence below suggests this is a platform boundary, not a creativity gap — **likely** (induction over all comparables found; no counterexample surfaced).
- **Strongest comparables, mechanism families:**
  1. **Separate application identity** — Chrome PWA app shims, Safari "Add to Dock" web apps. Both behaviors hold by construction, with fully ordinary focus/window semantics. **confirmed** (Chromium + Apple documentation).
  2. **Nonactivating `NSPanel`** — Spotlight/Raycast pattern; open-source exemplars Maccy and iTerm2 hotkey windows; Electron supports it via panel-type `BrowserWindow`. Neither behavior question arises because the owning app never activates and the panel never enters app-switch order. Materially different semantics. **confirmed** (Apple doc + sources).
  3. **Hide/show lifecycle on a floating always-on-top window with non-forcing activation** — Obsidian Floating Notes (the observed example). "Close" is actually hide (opacity 0 + click-through); the window never closes in normal use, so close-focus never arises. **confirmed** (plugin README + source).
  4. **Custom native shell window** — Arc Little Arc, the strongest *product-level* comparable (same concept: ephemeral link window opened from another app). Mechanism not public; circumstantial evidence says custom floating `NSWindow` under Arc's full control. **likely**.
  5. **Private-API single-window raise** — AltTab focuses exactly one window of another app via `_SLPSSetFrontProcessWithOptions`. Works, but private API + Accessibility permission; excluded by issue #31's constraints. **confirmed** (source), not applicable.
- **Applicability to Lil Chromium today:** the open side (behavior 1) is **blocked at the extension layer** — Chromium's focused-show path forces `[NSApp activateIgnoringOtherApps:YES]` then `makeKeyAndOrderFront`, and AppKit activation raises the app's previous main/key windows first (r01, **confirmed**); macOS ignores `focused:false` on create and `windows.update({focused:false})` is `NOTIMPLEMENTED` on Mac (r01, **confirmed**). No MV3 API can set window level, panel style, or app identity. The close side (behavior 2) has **no automatic OS return-to-predecessor** when the owning app stays active; the protocol's explicit `restore-focus` re-activation is the only public-mechanism design and matches what the platform gives third parties. Its reliability from an LSUIElement host on macOS 15/26 is **unverified**.
- **Most promising direction:** (a) close side — keep explicit prior-context restore, verify `NSRunningApplication.activate(from:)` efficacy on the real-Mac loop (#30); (b) open side — investigate a Helium fork patch (Helium is open source and the default Primary) that shows lil windows without forced whole-app activation, i.e. the Electron-style non-forcing path; otherwise document the boundary, which issue #32 explicitly permits. Panel semantics or separate identity would each require an architectural change (lils owned by Lil Chromium or by a helper app), i.e. a product decision, not a bug fix.

## Evidence

### A. Obsidian Floating Notes (the observed example) — hide/show + floating + non-forcing activation

- **confirmed (documented).** The plugin's README states the loopback HTTP trigger "Toggles the popout **without activating the Obsidian app or raising the main window**," while `open "obsidian://floating-notes"` "activates the Obsidian app on macOS, which briefly raises the main window" [S1]. This is direct documentation that (a) whole-app activation is what raises the main window, and (b) avoiding activation avoids the raise.
- **confirmed (source).** `main.ts`: the popout is an Obsidian `WorkspaceWindow` (Electron `BrowserWindow` accessed via `win.electronWindow`). On adopt: `setSkipTaskbar(true)`, `setAlwaysOnTop(true, "floating")`, then `bw.focus()`. **Hide is not close**: `hidePopout()` = `setOpacity(0)` + `setIgnoreMouseEvents(true)` + `setSkipTaskbar(true)`; show reverses and calls `focus()` [S2]. Esc hides; the window stays alive and invisible.
- **confirmed (source).** Electron's macOS `NativeWindowMac::Focus(bool)`: "If we're a panel window, we do not want to activate the app, which enables Electron-apps to build Spotlight-like experiences" — panels skip activation entirely; non-panels call `activateIgnoringOtherApps:NO` (not `YES`) before `makeKeyAndOrderFront` [S3]. Per Apple's `NSApplicationActivationOptions`, without the ignoring-other-apps flag the app "is activated only if there is no active application" (r01 S15), so the non-panel focus request is *refusable* when another app is frontmost — the contrast with Chromium's forced `YES` (r01 S9) is the crux.
- **unverified.** Which Electron path Obsidian popouts take (Obsidian is closed source). If popouts are panel-type windows, key status without activation is fully explained; if not, the observed no-raise follows from the refusable `NO` activation. Either way the mechanism is "request key status for the one window without forcing whole-app activation."
- **Semantics/tradeoffs (RQ4):** materially non-ordinary. Floating window level (above normal windows), hidden from task switcher, never truly closes (invisible-but-alive), Esc = hide. Multi-display behavior not documented. Because the window never closes and the app never activates, neither target behavior is ever exercised — the plugin sidesteps both rather than solving them.

### B. Arc Little Arc — strongest product comparable, custom native shell

- **confirmed (documented).** Little Arc "is a window that opens when you click a link from another desktop app"; Cmd-O promotes into a Space; auto-archives after hours [S4]. Opening external links in Little Arc is default behavior [S5, raycast/extensions#12334], with a user stating the intent: "I don't usually need to see my full browser if I am doing something quick from a link."
- **confirmed (third-party issues).** Little Arc windows were initially invisible to AltTab (failed its AX window check — "it's highly likely that Arc has an incorrect implementation of their windows," later partially fixed by Arc) [S6, alt-tab-macos#2257], and invisible to `chrome-cli`/AppleScript window enumeration ("Arc is doing something weird here") [S7, chrome-cli#92]. A Little Arc floats on top of a *fullscreen* Arc window and holds focus [S8, yabai#2388]. Net: Little Arc is a custom native window (high/floating level), not a standard Chromium window — Arc's shell is its own AppKit layer over Chromium, so Arc controls window creation, level, and activation directly.
- **likely.** Opening Little Arc from another app does not raise Arc's main window — this is the feature's documented purpose and matches all user reports found; no source states the mechanism (panel vs. custom activation). Close-focus behavior (what becomes frontmost when a Little Arc closes) is **unverified** — no direct report found; by construction Arc remains the active app, so ordinary semantics would leave Arc frontmost unless Arc explicitly re-activates the origin app.
- **Applicability:** none directly. Lil Chromium cannot replace the host browser's window layer; Arc owns its shell end-to-end.

### C. Separate application identity — Chrome PWA app shims; Safari web apps

- **confirmed (Chromium source).** "App shims are thin helper applications, created by Chrome, that enable web apps to show up as applications separate from Chrome on macOS… the app shim… start[s] acting as a remote cocoa host, displaying any windows for the app the shim represents" [S9]. The PWA's windows belong to the shim's process/identity, not Chrome's.
- **confirmed (Apple).** Safari "Add to Dock" (macOS Sonoma+): "A web app functions independently of Safari… saved to the Applications folder… open it from the Dock or Spotlight" [S10].
- **confirmed (by construction).** With a separate app identity, both target behaviors are simply ordinary macOS: activating the web app raises only its own windows (Chrome/Safari windows are another app's problem), and closing its last window follows ordinary app order — the previously active app returns on the next ordinary switch; there is no sibling layer to leak. This is the only mechanism family found that delivers both behaviors *with* ordinary semantics.
- **Tradeoffs:** requires an install gesture, a manifest, a persistent on-disk bundle (`~/Applications/Chrome Apps`), Dock/Cmd-Tab presence per app — the opposite of ephemeral. No extension API creates shims; `chrome.windows.create` cannot mint identity. `--app=url` windows remain ordinary windows of the browser app (no shim).

### D. Nonactivating NSPanel — Spotlight/Raycast pattern; Maccy; iTerm2

- **confirmed (Apple).** `NSWindow.StyleMask.nonactivatingPanel`: "The window is a panel or a subclass of NSPanel that does not activate the owning app" [S11].
- **confirmed (source).** Maccy's `FloatingPanel`: `NSPanel` with `[.nonactivatingPanel, …]`, `isFloatingPanel = true`, `level = .screenSaver`, `collectionBehavior = [.auxiliary, .stationary, .moveToActiveSpace, .fullScreenAuxiliary]`, shown via `orderFrontRegardless()` + `makeKey()`, `canBecomeKey = true` so text input works, and auto-`close()` on `resignKey()` [S12]. Maccy is an LSUIElement menu-bar app; the panel takes keyboard focus while the previously active app stays active, and closing it is a focus non-event (key status returns to the still-active app's window). This references the canonical community recipe (SO 46023769: LSUIElement + non-activating NSPanel + `makeKeyAndOrderFront` + `orderFrontRegardless`) [S13].
- **confirmed (source).** iTerm2's floating hotkey window maps to `NSWindowStyleMaskNonactivatingPanel` (`iTermPanel`/`iTermCompactPanel`) [S14] — a mainstream terminal uses the same pattern for its drop-down auxiliary window.
- **confirmed (source).** Electron panel-type `BrowserWindow`s get the same treatment (skip activation in `Focus()`) [S3].
- **Semantics/tradeoffs:** the panel floats above normal windows, has no Cmd-Tab/Dock presence, no menu bar, conventionally auto-closes on blur, and does not participate in ordinary window ordering as a normal window. Ordinary app/window order is preserved trivially — the owner never enters the app-switch order — but the window is *not* an ordinary window.

### E. AltTab — single-window focus of other apps (private API; also documents the default)

- **confirmed (source).** AltTab's `ActivationFocusResolver` documents ordinary macOS activation from live traces: "on activation macOS emits 808s for the app's on-Space windows — the FIRST is the genuinely FOCUSED window, the rest… are RAISES front-to-back" [S15]. This is independent confirmation of the sibling-raise Lil Chromium fights (r01's AppKit main/key raise), observed from the WindowServer event side.
- **confirmed (source).** AltTab "raises exactly one window (`_SLPSSetFrontProcessWithOptions` with a wid) rather than fronting the app's whole stack" [S15] — a private SkyLight API, not Apple-supported (also flagged in r01), and AltTab's window operations depend on Accessibility permission. Excluded by issue #31 ("no product dependency on Accessibility permission") and by "public platform behavior."
- **Corroborating boundary (third-party).** An unrelated macOS project's spike notes: "macOS has no public API to change another app's window z-order… `CGSSetWindowLevel` on a foreign window is silently ignored by WindowServer" [S16].

### F. Chromium/extension-layer constraints (from r01, restated for applicability)

- **confirmed.** Focused `windows.create`/`update` → `kShowAndActivateWindow` → `[NSApp activateIgnoringOtherApps:YES]` then `makeKeyAndOrderFront`; AppKit raises the previous main/key window first — often the normal browser window on another display (r01 Q2).
- **confirmed.** `focused:false` on create is ignored on macOS per field reports; `update({focused:false})` hits `NativeWidgetMac::Deactivate()` = `NOTIMPLEMENTED()` (r01 Q2). There is no extension API for window level, panel-ification, non-activating show, or app identity.
- **confirmed.** Cooperative activation (macOS 14+): activation is a request; only the active app can `yieldActivation`; the native-messaging host is not the active app; `activate(from:options:)` returning true means the request was allowed, not granted (r01 Q3).

### G. Applicability to Lil Chromium (RQ5)

| Mechanism | Demonstrated by | Available in current architecture? |
| --- | --- | --- |
| Separate app identity per window | Chrome PWA shims, Safari web apps | **Blocked.** No extension API; install+manifest+persistence contradict ephemeral lils. Architectural change: ship helper app(s) that own lil windows. |
| Nonactivating NSPanel | Maccy, iTerm2, Spotlight/Raycast, Electron panels | **Blocked.** Lil NSWindows belong to the browser process; the Swift agent owns only its own windows (the palette already uses this pattern). Architectural change: lils owned by LilChromium.app (WKWebView/CEF) — breaks "the user's real Chromium browser." |
| Hide/show lifecycle | Obsidian Floating Notes | **Blocked.** Extension can only minimize (Dock-visible), not hide/opacity/click-through; lils are per-URL ephemeral, not a reusable singleton. |
| Non-forcing activation (`ignoringOtherApps:NO`) or panel-ified show | Electron apps | **Blocked at extension layer; possible via Chromium fork patch.** Helium is open source (imputnet/helium, actively developed) and the default Primary — a fork patch could alter the focused-show path for lil windows, but coverage is per-browser. |
| Private SkyLight single-window raise | AltTab | **Excluded.** Private API + Accessibility permission (issue #31 forbids the AX dependency). |
| Explicit re-activation of recorded predecessor on close | Lil Chromium's own `restore-focus` (protocol v2) | **Applicable now.** The only public-mechanism design for behavior 2; best-effort under cooperative activation. |

### H. Direction (RQ6)

1. **Close side (behavior 2 / issue #31):** proceed with the explicit prior-context restore already in the protocol — it matches the only public mechanism (no OS-level return-to-predecessor exists when the owning app stays active; AltTab's traces show even ordinary activation is a focus+raise event storm that apps must reason about explicitly). Next step is verification, not design: does `NSRunningApplication.activate(from:)` from the LSUIElement host actually foreground the recorded predecessor on macOS 15/26, multi-display? That is the #30 real-Mac loop's job.
2. **Open side (behavior 1 / issue #32):** no MV3-level fix exists; the raise is Chromium's forced `activateIgnoringOtherApps:YES` plus AppKit's main/key raise. Investigate in order: (a) a Helium fork patch adopting the Electron-style non-forcing show for lil windows (strongest evidence-backed lever; Helium is the default Primary and OSS); (b) accept and document the platform boundary — issue #32 explicitly allows "documents any unavoidable platform boundary with evidence"; (c) only if the boundary is unacceptable, an architectural change (helper-app-owned lils, the PWA-shim pattern productized) — a product decision, not a bug fix.
3. **Cross-cutting:** every mechanism that fully delivers both behaviors changes identity or semantics; choose which invariant (real-Chromium rendering vs. ordinary focus behavior) matters more before committing to (c).

## Gaps

Not blocking the direction above; blocking precise root-cause claims about specific comparables.

- No live-Mac experiments in this run; all claims are source/documentation/issue-tracker based. Little Arc and Obsidian are closed source.
- Little Arc: open-time no-raise is product-intent + circumstantial evidence, not a documented mechanism; close-focus behavior not directly reported anywhere found (searched, result empty).
- Obsidian popout window class (Electron panel vs. normal) unknown — determines which Electron focus path Floating Notes exercises.
- Whether `activate(from:)` from an LSUIElement child of Chromium reliably foregrounds a third app on macOS 15/26: carried over unverified from r01; needs the #30 real-Mac loop.
- Multi-display specifics ("Displays have separate Spaces") are thinly documented for every comparable; no per-display open/close traces found for any of them.
- Whether a Helium fork patch can show a popup window key without whole-app activation (and without a Space switch) is uninvestigated — it is the top engineering unknown for the open side.

## Sources

| ID | Locator | Retrieved | Freshness |
| --- | --- | --- | --- |
| S1 | https://github.com/haotiencheng/obsidian-floating-notes (README) | 2026-08-26 | fresh |
| S2 | https://github.com/haotiencheng/obsidian-floating-notes/blob/main/main.ts | 2026-08-26 | fresh |
| S3 | https://github.com/electron/electron/blob/main/shell/browser/native_window_mac.mm (`NativeWindowMac::Focus`, lines 444–459) | 2026-08-26 | fresh |
| S4 | https://resources.arc.net/hc/en-us/articles/19235387524503-Little-Arc-Quick-Lookups-Instant-Triaging | 2026-08-26 | fresh |
| S5 | https://github.com/raycast/extensions/issues/12334 | 2026-08-26 | fresh |
| S6 | https://github.com/lwouis/alt-tab-macos/issues/2257 | 2026-08-26 | fresh |
| S7 | https://github.com/prasmussen/chrome-cli/issues/92 | 2026-08-26 | fresh |
| S8 | https://github.com/koekeishiya/yabai/issues/2388 | 2026-08-26 | fresh |
| S9 | https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/app_shim/ (README) | 2026-08-26 | fresh |
| S10 | https://support.apple.com/en-us/104996 (Use Safari web apps on Mac) | 2026-08-26 | fresh |
| S11 | https://developer.apple.com/documentation/appkit/nswindow/stylemask (`nonactivatingPanel` entry) | 2026-08-26 | fresh |
| S12 | https://github.com/p0deje/Maccy/blob/master/Maccy/FloatingPanel.swift | 2026-08-26 | fresh |
| S13 | https://stackoverflow.com/questions/46023769/how-to-show-a-window-without-stealing-focus-on-macos (via exchangetuts mirror + Maccy reference) | 2026-08-26 | fresh |
| S14 | https://github.com/gnachman/iTerm2/blob/master/sources/TerminalView/PseudoTerminal+WindowStyle.m (lines 153–160, 1043–1044) | 2026-08-26 | fresh |
| S15 | https://github.com/lwouis/alt-tab-macos/blob/master/src/windowserver/ActivationFocusResolver.swift | 2026-08-26 | fresh |
| S16 | https://github.com/andhikapraa/topsy/blob/main/docs/dev/HANDOFF.md | 2026-08-26 | fresh |
| — | https://github.com/imputnet/helium (repo metadata: OSS Chromium browser, default Primary) | 2026-08-26 | fresh |
| — | docs/research/r01-chromium-macos-focus-session-restore.md (Chromium `main` + Apple activation/session citations reused, originally retrieved 2026-08-24) | 2026-08-24 | cached |
| — | `cli-anything-exa search` (orientation queries: auxiliary-window focus, Little Arc, Obsidian pop-outs, PWA shims, Safari web apps; n=5 each) | 2026-08-26 | fresh |
