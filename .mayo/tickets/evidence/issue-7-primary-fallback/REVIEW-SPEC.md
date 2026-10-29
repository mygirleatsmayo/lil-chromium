# Spec review — issue #7

**Verdict:** No spec findings.

Target: `v0.4/issue-7-primary-fallback` @ `ddb624741edcc9a09474f0b724b751f308bfc848` vs `release/v0.4` @ `ea58b515357bda113e3dd3b8738d4cd9fef09c93`. `gh issue view 7 --comments` and `gh issue view 2 --comments` are empty. Issue #6 ledger is empty; settled installer-list pin and three-component catalog lockstep.

## 1. Missing or partial

None.

## 2. Unrequested behavior

None user-facing. Fallback-picker exclusion, missing/identical warning, schema v3 with legacy-key preserve, and launch-by-catalog-bundle-id implement #7 / #2 / PROTOCOL. No profile routing, no frontmost-browser heuristic, no destructive migrator.

## 3. Implemented but wrong

None.

## Checked

1. **“User-facing and canonical v0.4 contract vocabulary says Primary browser, never default browser, for the configured Chromium destination.”** (#7 AC; #2 ID 3; CONTEXT.md Primary vs Avoid Default browser) Settings “Primary browser”, hover `Open in {primaryBrowserName}`, command description, PROTOCOL `primaryBrowser` / context fields. “Set as Default Browser…” and PROTOCOL “system default handler” stay Lil Chromium’s OS role (#2 ID 3).

2. **“Primary and Fallback choices refer to browser installations and cannot silently collapse sibling release channels.”** (#7 AC; #2 US 2–4, ID 10–12; ledger criterion 1) Fallback choices filter by slug; `chrome` / `chrome-beta` stay distinct in sockets and `BrowserTable` launch IDs. Profiles untouched (ledger: never routing targets).

3. **Relay then launch order.** (#7 AC; PROTOCOL “App routing order”) `socketOrder` is Primary, Fallback, other live (newest mtime from `allSocketURLs`); `sendOpen` continues on connect failure before `openFirstAvailable`.

4. **Direct launch never bare-opens.** (#7 AC; PROTOCOL steps 4–5) Primary, Fallback, then other installed bundle IDs; nil Launch Services URL or launch error advances. Missing Primary keeps Fallback and installed candidates.

5. **“Palette history and lil promotion use the configured Primary installation semantics.”** (#7 AC; PROTOCOL `primaryBrowser` / history-query steps 1–3) `historyQuery` uses `routedSockets`; promote / ⌘O / `open-external` use `primaryBrowser`.

6. **“Existing v0.3 explicit browser configuration remains readable without a destructive migration; v0.4 writes preserve unknown fields.”** (#7 AC; #2 ID 17) Decode `defaultBrowser` when `primaryBrowser` is absent; merge keeps the legacy key plus unknowns; version `max` upgrades older files to 3 and never downgrades.

7. **Lockstep.** (#7 AC; #2 ID 51) App, host, extension, shared fixtures, PROTOCOL. Installer has no identity vocabulary; issue #6 catalog pin still holds.

8. **Native tests** cover missing Primary candidates, identical legacy launch, and sibling-channel relay/launch (#7 AC).
