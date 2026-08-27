---
type: note
created: 2026-08-24 18:22:43
modified: 2026-08-25 09:33:21
---

# lil-chromium v0.4 trial — Devin session hunches (focus triad + wake-to-tab)

Status: hypotheses, NOT verified. Ranked by confidence. File:line refs are trial/v0.4-live (worktree `~/projects/lil-chromium-v0.3`).

## Architecture facts established (verified by reading code)

- Prior-context capture: app records frontmost external app (PID+bundleId) BEFORE relay send (`mac/Sources/LilChromiumApp/OpenRouter.swift:76-112`). Extension then OVERRIDES it: `capturePriorContext()` (`extension/background.js:578-587`) queries `chrome.windows.getAll({})`; if ANY window reports `focused:true`, it records that browser window as predecessor and DISCARDS the app-supplied external app. External app is used only when no window reports focused.
- Close path: `onRemoved` (`background.js:852-875`) restores predecessor only if `wasFocused` (tracked via `onFocusChanged`, `background.js:266-282`). External restore = `restore-focus` msg → host → `NSRunningApplication.activate(options:[.activateIgnoringOtherApps])` (`mac/Sources/lilchromium-host/ExternalAppRestorer.swift:14-24`).
- Palette path is identical to external-link path (same `OpenRouter.open()`); palette panel is non-activating, so frontmost app at capture = user’s real app. Good.
- wakeLil (`background.js:1368-1421`) is strictly same-window: creates fresh INACTIVE tab in the nap page’s OWN window (`tabs.create({windowId, active:false})` line 1382), swaps, removes nap tab. If registry entry missing → returns false → sleep.js fallback navigates in place. NO code path opens a tab in another window.

## Hunch 1 (HIGH confidence) — stale Chromium `focused` state poisons predecessor capture → close-focuses-primary-browser bugs (QA items 1 & 3)

On macOS, Chromium is suspected (known-crbug territory — research worker was asked to confirm) of reporting the last-active window `focused:true` in `windows.getAll` even when the app is NOT frontmost, at least in some states/orderings — even after `onFocusChanged(WINDOW_ID_NONE)` fired. If so: user in Mail clicks link → app correctly records Mail → extension sees stale `focused:true` on the primary normal window → records predecessor = normal-window → on close, `focusWindow(primary)` = EXACT reported symptom (close focuses primary browser, both external-link lils and palette lils).

- Key smell: `capturePriorContext()` uses `getAll().focused` instead of the extension’s own `focusedWindowId` state (which correctly holds WINDOW_ID_NONE after deactivation). Two sources of truth; the wrong one wins.
- Intermittency fits: staleness depends on whether a browser window was key recently, whether WINDOW_ID_NONE fired, SW cold/warm start timing.
- Candidate fix direction: trust `focusedWindowId` (onFocusChanged state) over `getAll().focused`; or require both to agree before overriding the app-supplied external context; prefer app-supplied external context whenever the OS-level frontmost app isn’t the browser (the app KNOWS — it captured frontmost at open time).

## Hunch 2 (MEDIUM-HIGH) — spec-level design flaw: predecessor = app-at-OPEN, user expects app-at-CLOSE (QA item 1 “non-fix”)

Issue #15 spec restores the RECORDED opener (Mail), not the app used immediately before closing. Lucas’s expectation: closing a lil should behave like closing any app’s window — yield to the actual MRU app at close time. Scenario: open lil from Mail → cmd-tab to Notes → refocus lil → close → spec restores Mail, Lucas wants Notes. Even a perfect implementation of #15 produces “wrong” focus here. Needs a design decision: record-at-open (current spec) vs MRU-at-close (Lucas’s stated model, matches macOS conventions). MRU-at-close may need no native bookkeeping at all for the external case — just DON’T focus anything and let macOS unwind naturally, EXCEPT Chromium hands key to its next window (primary) when its key window closes, which is why explicit restoration exists. Possible elegant middle: on close of a focused lil whose predecessor is external, activate the CURRENT frontmost-app-before-close (host could snapshot NSWorkspace.frontmostApplication… but at close time frontmost IS the browser). Alternative: native app tracks app-activation history (NSWorkspace didActivateApplicationNotification) and restores the most recent non-browser, non-self app at close. That is the “know the app I used immediately before closing” model Lucas described.

## Hunch 3 (MEDIUM) — focused create raises the browser’s previous key window (QA item 2, open raises primary window)

No native activation happens on the happy open path (verified: relay path has zero NSWorkspace/activate calls; fallback `config.activates=true` only when relay is DOWN, `OpenRouter.swift:162-164`). So the raise must come from Chromium itself activating when the extension does `windows.create({focused:true})` + `windows.update({focused:true})` (`background.js:640-653`). Hypothesis: during app activation macOS/Chromium orders the app’s CURRENT key/main window (= primary normal window) forward before/along with the new popup becoming key — visible especially cross-display (separate Spaces: each display raises its own front window of the active app). Fits Lucas’s repro: first click after browser had a key normal window = bad; immediately after a lil cycle (previous key window was the now-closed lil) = good. Candidate mitigations: create focused only (drop the redundant second update when create succeeded focused); or create unfocused → single explicit focus; verify against research findings.

## Hunch 4 (MEDIUM, for close-restore failures even with correct predecessor) — cooperative activation may drop host’s activate

macOS 14+ cooperative activation rules may make `NSRunningApplication.activate(.activateIgnoringOtherApps)` from the faceless host unreliable (deprecated option; activation can be denied while browser is frontmost; can also return true without effect). If restore-focus arrives but activation is denied → browser keeps focus (same symptom as Hunch 1). Distinguishable via host log + testing. Fix direction: activation from the LilChromiumApp agent instead of host, `activate(from:options:)`/yieldActivation, or research-recommended pattern.

## Hunch 5 (WEAK — wake-to-tab, QA item 4; Lucas’s answers contradict parts of this)

Facts: wakeLil cannot create a tab in another window. Lucas: NEW lils (created minutes ago, post-reload) wake into the primary browser as tabs. If truly new lils misroute, the registry entry must be missing/stale AT WAKE TIME (then sleep.js fallback navigates… in place — still doesn’t explain moving to primary window), OR the nap/wake path isn’t what runs. Remaining suspects, in order:  
  a. Registration failing or registry entries lost for new lils NOW (would also collapse close-restore for every new lil → would explain “everything got worse recently”). Check: is `registerWindow` failing (chrome.storage errors after remove/re-add?), SW error loop? chrome://serviceworker-internals / SW console errors. THIS IS THE FIRST THING TO CHECK LIVE: open new lil → inspect registry (SW console: chrome.storage.local.get) → is the entry there?  
  b. The “wake” Lucas performs is not sleep.js click → wakeLil but another surface (palette? history? notification?) that routes through a different open path landing in a normal window (e.g., `open-external`? tabs.create default window?).  
  c. Helium-specific behavior: tabs.create into a type:popup window redirected by the fork into the last normal window. But then it would have ALWAYS happened — unless Helium AUTO-UPDATED mid-trial (timing fits “started while talking to you”!). CHECK: Helium version/update date vs bug onset.
- The mid-session onset with NO code change strongly suggests environmental pivot: Helium auto-update, storage/SW state corruption, or profile-level setting change. Helium update is the cleanest candidate — check its version history/last-update timestamp first.

## Immediate next diagnostic steps (cheapest first)

1. Check Helium auto-update timestamp vs bug onset (wake-to-tab started mid-session today).
2. SW console on live Helium: `chrome.storage.local.get('ephemeralWindows')` after opening a fresh lil → is it registered? After napping → slept flags present? (Answers Hunch 5a instantly.)
3. Host log `~/.lilchromium/host-helium.log`: are `restore-focus` messages arriving on lil close? (Splits Hunch 1 — wrong predecessor recorded, no message — from Hunch 4 — message sent, activation failed.)
4. Await research worker report (stale focused crbugs, cooperative activation, session restore) → fold into test plan.
5. Live differential tests (Lucas or computer-use worker): open-from-Mail with/without prior browser key window; close focused vs unfocused (title-bar close without focusing skips restore entirely by design — `wasFocused` gate, background.js:865 — closing via title-bar button while lil unfocused = NO restoration runs; if Lucas mostly closes that way, “no restore” is expected behavior today, not a regression — worth asking).
6. Note: extension test suite (pnpm, fake Chrome) models IDEAL focused semantics — all 15 focus tests pass against the fake; the real-Chromium divergence (stale focused) is exactly what the fake can’t catch. Regression test requires teaching the fake the stale-focus behavior once confirmed.

## Surfx tasks in flight (cursor-grok-4.6-high)

- MPBLMIJo: version visibility (bundle-app.sh git describe; Settings footer; manifest 0.4.0 + version_name; caret-menu footer). Awaiting review — diff via `surfx output MPBLMIJo --diff`, then accept --apply.
- 417FA8PB: research (Q1 stale focused, Q2 focused-create raising siblings, Q3 cooperative activation, Q4 session restore of extension popup pages). Lucas re-running brief with proper research skill; brief at /tmp/surfx-briefs/brief-focus-research.md.
