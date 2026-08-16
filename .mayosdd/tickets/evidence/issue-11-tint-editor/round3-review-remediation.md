# Remediation review — Issue #11, fix round 1

- **S1 = P1** — `resolved`. `guard let hex, !hex.isEmpty else { return TintPreset.graphite.hex }`
- **Central claim** — holds. `TintPreset.graphite.hex` is `#8e8e93`. Lil Nap writes that via `sleepStorage` (nil/empty → graphite hex). `extension/background.js:1012` (`ctx.sleep.tint ? … : "purple"`) and `extension/sleep.js:23` (`params.get("tint") || "purple"`) treat non-empty `#8e8e93` as truthy. `sleep.js:42–50` `resolveTint` hex-decodes it; it does not fall through to `NAMED.purple`. Extension not edited.
- **Criterion 1** — holds. One `TintEditor`; two call sites. `offersNoTint` is a parameter, not a second component.
- **Hoverbar** — unchanged. Still `TintEditor(committed: hoverTintBinding, …)` with default `offersNoTint: true`. `hoverTintBinding` still omits the key via `hoverBarStorage(fromCommitted: nil)`.
- **Deleted tests** — `sleepNoTintStorageIsEmptyNotDefaultPurple` and `sleepNoTintRoundTripsWithoutBecomingDefaultPurple` pinned `""`. Removal follows the owner decision (no Lil Nap no-tint; graphite is neutral). Replaced by graphite storage/round-trip tests.
- **N1 (high)** — `sleepTintBinding` skip: `guard current != TintValue.committedHex(fromSleep: stored)`. `committedHex(fromSleep:)` now maps `""`/`"none"` to `#8e8e93`, so leftover empty/`none` on disk shows graphite selected and never writes. `writeCommitted` also no-ops: coalesced get already equals graphite hex. Extension still sees falsy `""` and paints purple. Binding comment (“legacy empty storage commits graphite”) is false. Tests cover `sleepStorage(nil)`, not this skip. Repro: `sleep.tint` `""` → graphite looks selected, overlay stays purple; clicking graphite does nothing. Escape: pick another chip, then graphite.
- **needs adjudication** — none.
- No other new defects in the delta. SwiftUI-pro (data/views/swift/a11y/hygiene): none in this delta.
