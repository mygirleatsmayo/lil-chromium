# Spec review — issue #12

**Verdict:** No spec findings.

Range: `3c36c9a…` … HEAD `9423784…` (brief `09423784…` does not resolve). Issues #12 and #2: no comments.

## 1. Missing or partial

None.

## 2. Unrequested behavior

None user-facing. `context` also fans out to live lils (PROTOCOL reconnect catch-up). Reveal-zone slider, slug-sorted `config-update`, and overlay default 15 (was hardcoded 24) are #12 / #2 / PROTOCOL. Launch and Settings `reload()` do not broadcast — they are not Settings writes.

## 3. Implemented but wrong

None.

## Checked

1. **“A native Settings write publishes the normalized full configuration to every live relay, not only the current routing target.”** (#12 AC; #2 ID 18; PROTOCOL `config-update`) `didSet` saves, then `broadcastConfig` walks slug-sorted `allSocketURLs`, not `socketOrder`.

2. **“Each host forwards the new configuration to its extension; each worker replaces its cached context and notifies every live lil.”** (#12 AC; PROTOCOL) Host forwards and never queues. `applyConfigUpdate` keeps `browser`/`browserName`. Fanout covers registry plus `incognitoLils`. Overlay `contextUpdate` runs `applyStyle` / `applyContextLabels`; mousemove reads `revealHeight`.

3. **“Preferences that seed new lils affect future lils without overwriting existing per-lil overrides.”** (#12 AC; #2 ID 19, US 27–28, 63; CONTEXT.md Per-lil override) Registry expiry untouched; new lils seed `ephemeralDefault`. Tint, style, promote label, and reveal zone update in place.

4. **“A disconnected relay catches up from the config file when it reconnects.”** (#12 AC; PROTOCOL) Reconnect re-asks `get-context`; host `LilConfig.load()`; `context` pushes to live lils.

5. **Reveal zone default 15, clamp 0–48, zero + ⌘L.** (#12 AC; #2 ID 38, US 60–62; PROTOCOL `hoverBar`; CONTEXT.md Reveal zone) Model clamps on decode/write; slider 0…48; overlay `zone > 0 &&`; `focusAddress` ignores the zone.

6. **Multi-relay / multi-lil tests.** (#12 AC; #2 TD 4, 8) Native: slug order, closed fixture, clamp, additive 15. MV3: identity-preserving replace, 3-lil tint/reveal, future-lil vs override, disconnect/reconnect. Shared `message-config-update.json`.

7. **“Unknown config fields remain preserved throughout writes and broadcasts.”** (#12 AC; #2 ID 17; PROTOCOL rewrite) `save()` still `ConfigMerge`. The wire is the closed `context` subset PROTOCOL names.

8. **Lockstep / no duplicate extension Settings.** (#2 ID 51, Out of Scope) App, host, extension, PROTOCOL, fixtures. No per-browser global UI.
