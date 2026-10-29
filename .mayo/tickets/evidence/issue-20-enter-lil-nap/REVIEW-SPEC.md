# Spec review — issue #20 (Enter Lil Nap safely and truthfully)

Fixed: `3c36c9a` → head `a6494a2` (1 commit, 11 files, +493/−46). Sources: issue #20, issue #2 full body, issue-5 ledger, `CONTEXT.md`, `docs/PROTOCOL.md` at HEAD.

## Findings by severity

### S1 (medium) — AC1 partial: stale "sleep" copy in whitelist UI
AC1: "**All** user-facing resource-saving copy uses Lil Nap/napping and the actions Let This Lil Nap and Wake This Lil." Parent decision 43: "Remove 'Sleep this lil,' 'Sleeping lil,' and similar stale copy"; story 71: "all old Sleep/sleeping user-facing copy replaced with Lil Nap language"; `CONTEXT.md` Lil Nap, Avoid: "Sleep, sleeping lil".
Unchanged at HEAD: context menu `"Never sleep this site"` (background.js:1735) and dynamic `"Allow sleeping " + host` / `"Never sleep " + host`; native Settings `TextField("Add domain (never sleep)", …)` (SettingsWindow.swift:333). Menus, toggles, picker, nap page, and hint were renamed; whitelist surfaces were not.

### S2 (medium) — release fallback pollutes history; failure ignored
AC4: "The internal nap document **replaces** rather than pollutes user-visible back/forward history"; PROTOCOL.md: "the nap URL must not sit on top of the live page in back/forward". `replaceTabDocument` falls back to `chrome.tabs.update(tabId, {url})` when `scripting.executeScript` fails — pushing a new history entry (reachable where capture succeeds but scripting is blocked, e.g. plugin-document pages). Also, `sleepLil` ignores the `false` return and returns `true`: the registry already holds `slept/sleepCaptureKey/originalUrl`, but the original document stays live — the AC8 oracle then claims nap for a live tab, and AC7 restart restore would reopen a stale nap page over a lil the user kept using.

### S3 (low) — restored nap document drops configured tint
AC7: restart "restores recorded napping lils as nap documents"; PROTOCOL.md: "The page shows the screenshot under a tinted overlay (config `sleep.tint`)". `restoreWindows` passes `undefined` tint to `sleepPageUrl`, so sleep.js defaults to `"purple"` — a lil napped with gray/custom tint restores purple. (Pre-existing v0.3 behavior, but the call site and protocol line were rewritten here.)

## Checked, no findings
AC2 capture→record→release order (journal-order test); AC3 `💤 ` prefix; AC5 "Shhh… this lil is napping." + icon 96→160px (1.667×, "roughly 67 percent"); AC6 incognito guards (sleepLil:1059, sweep:1202) + never-captured test; AC7 no live-load restore (windows.create journal); AC8/AC9 oracle and all six listed test areas, including discard/freeze distinction and alarm entry. Unrequested behavior: none; the new `scripting` permission is the mechanism AC4 requires. Issue-5 settled interpretations respected. Suite not executed (deps absent); review is static.
