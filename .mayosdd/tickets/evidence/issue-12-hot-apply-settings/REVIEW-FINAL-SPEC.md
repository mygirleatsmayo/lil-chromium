# Final Spec review — issue #12

**Verdict:** No spec findings.

Refs resolve. Fixed point `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` … HEAD `d0262a51d7b7bd71046790c5df9289de79e1decc`. Diff non-empty. Ledger frozen; S1–S3 are Standards-only. Round-1 Spec “No findings” and its checked interpretations stand. Issues #12 and #2: empty `comments`.

## 1. Missing or partial

None.

## 2. Unrequested behavior

None as product behavior. Reconnect `context` fanout to live lils is PROTOCOL (`config-update` paragraph). Slider `accessibilityValue` is ledger S3, not a new setting. Launch/`reload()` still do not broadcast (settled: not Settings writes).

## 3. Implemented but wrong

None.

## Checked (settled ACs still hold at HEAD)

1. **Every live relay, not the routing target.** #12 AC; #2 ID 18 (“publishes the normalized full configuration to every live relay, not only the selected routing target”); PROTOCOL: “EVERY live `relay-*.sock`, slug-sorted — not only the routing target.” `didSet` → `save()` → `broadcastConfig` over `broadcastTargets(allSocketURLs)`, not `socketOrder`.

2. **Host forward; worker replace; every live lil.** #12 AC; PROTOCOL: host “forwards the line verbatim … never queues”; worker keeps `browser`/`browserName`; `broadcastContextToLils` covers registry + `incognitoLils`. Overlay `contextUpdate` → `applyStyle` / `applyContextLabels`; mousemove uses live `revealHeight`.

3. **Future-only defaults vs live overlay prefs.** #12 AC; #2 ID 19, US 27–28, 63, 68; CONTEXT.md **Per-lil override**. Registry expiry untouched; new lils seed `ephemeralDefault`. Tint/style/labels/reveal update in place.

4. **Reconnect catch-up from the file.** #12 AC; PROTOCOL: `get-context` “fresh config.json read” then push to live lils. Host `LilConfig.load()` + shared `ContextPayload` (S2; same mapping as `config-update`).

5. **Reveal zone 15 / 0–48 / zero + ⌘L.** #12 AC; #2 ID 38, US 60–62; PROTOCOL `hoverBar`; CONTEXT.md **Reveal zone**. Model clamps decode/write; slider `0...48`; overlay `zone > 0 &&`; `focusAddress` calls `reveal()` without the zone.

6. **Multi-relay / multi-lil tests.** #12 AC; #2 TD 4, 8. Native: slug order, empty targets, clamp, additive 15, zero round-trip, shared fixture. MV3: identity-preserving replace, 3-lil tint/reveal, future-lil vs override, disconnect/reconnect.

7. **Unknown fields on writes; closed wire on broadcast.** #12 AC; #2 ID 17; PROTOCOL rewrite + named `config-update` fields. `save()` still `ConfigMerge`. Wire = `context` config subset minus host identity (settled).

8. **Lockstep; no duplicate extension Settings.** #2 ID 51, Out of Scope. App, host, extension, PROTOCOL, fixtures. Hoverbar section has the reveal-zone slider.
