# Final spec review — issue #7 (Primary / Fallback)

Range `ea58b515…d707f9a6`. Contract: issue #7 ACs. Parent #2 IDs 2–3, 10–13, 17, 51; US 1–5. Issue #6 ledger settled 1–2. Issue #7 ledger interpretations 1–4; S1/S2 resolved. Issue #27 not adjudicated (settled 4).

**Verdict:** No spec findings.

## Findings by severity

None.

**(a) Missing or partial:** none. **(b) Unrequested:** none user-facing. Fallback-picker exclusion and the missing/identical warning implement #7 “distinct” plus PROTOCOL Settings excluding Primary while keeping sibling channels. `BrowserTable` launch IDs (not stale `knownBrowsers.bundleId`) implement “cannot silently collapse sibling release channels.” No profile routing, frontmost heuristic, or destructive migrator. **(c) Implemented but wrong:** none. **(d) Ledger regression:** none. S1: hoverbar, ⌘O, and caret all `promote("primary")`. S2: Fallback warning keeps `.help` and has `.accessibilityLabel`.

## What was checked

`gh issue view 7 --json` (nine ACs, 0 comments); `gh issue view 2 --json` (0 comments); both ledgers; `CONTEXT.md`; `docs/PROTOCOL.md`; `git diff` / `git log` `ea58b515…d707f9a6`.

1. **Primary vocabulary, never default, for the configured Chromium destination.** (#7 AC; #2 ID 3; CONTEXT.md Avoid Default browser) Settings “Primary browser”; hover `Open in {primaryBrowserName}`; command description; PROTOCOL `primaryBrowser`. “Set as Default Browser…” is Lil Chromium’s OS role (#2 ID 3).
2. **Installations, not collapsed channels.** (#7 AC; #2 US 2–4, ID 10–12; ADR-0002; #6 criterion 1) Fallback choices filter by slug; `chrome` / `chrome-beta` stay distinct sockets and catalog launch IDs. Profiles untouched (#6: never routing targets).
3. **Relay then launch.** (#7 AC; PROTOCOL “App routing order”) `socketOrder` is Primary, Fallback, other live newest-mtime; `sendOpen` continues on connect failure; `historyQuery` is steps 1–3.
4. **Direct launch never bare-opens.** (#7 AC; PROTOCOL steps 4–5) Primary, Fallback, then installed catalog bundle IDs; nil app URL or launch error advances. Missing Primary keeps Fallback and installed candidates.
5. **Palette history and promotion use Primary.** (#7 AC; PROTOCOL) `historyQuery` uses `routedSockets`; `promoteTab` / ⌘O / `open-external` use `primaryBrowser`.
6. **Missing Primary does not drop the URL.** (#7 AC) Empty/uninstalled Primary is skipped or attempted, then the remainder runs.
7. **v0.3 readable; unknown fields preserved.** (#7 AC; #2 ID 17; PROTOCOL) Decode `defaultBrowser` when `primaryBrowser` is absent; merge keeps the legacy key plus unknowns; version `max` upgrades older files to 3, never downgrades.
8. **Lockstep.** (#7 AC; #2 ID 51) App, host, extension, fixtures, PROTOCOL. Installer has no identity vocabulary; #6 `installScriptListsTheFullCatalog` pin remains.
9. **Native tests** cover missing, identical-legacy, and sibling-channel cases (#7 AC).
