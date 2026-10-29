1. **N1 — resolved.** Empty/`"none"` are no longer graphite for skip, and a graphite click now reaches the setter.

```
case "", "none": return nil
```

```
committed = model.committed
```

Getter still `?? TintPreset.graphite.hex`. Setter uses `sleepTintIfChanged` with no graphite fallback on `current`, so `nil != "#8e8e93"` and the write proceeds.

2. Skip table — shown chip; click that chip; `sleepTintIfChanged` vs disk. PROTOCOL tokens must not become hex on Settings open (getter-only; no `writeCommitted`).

- `""` — graphite — writes `#8e8e93` — right (N1)
- `"none"` — graphite — writes `#8e8e93` — right (N1)
- `"gray"` — graphite — no write — right (token kept)
- `"grey"` — graphite — no write — right (token kept)
- `"purple"` — purple — no write — right (token kept)
- `#rrggbb` — that colour (graphite chip if `#8e8e93`; else custom) — no write when re-committing the displayed hex — right

3. **`writeCommitted()` always-assign does not weaken hoverbar.** It runs only from chip click, color-well change, and draft set — not init or `onChange(reloadToken)`. Hoverbar still `guard current != newHex` before `hoverBarStorage`. Same nil no-tint or same hex is a no-op. Mere display does not write. Re-clicking the shown chip does not persist. `hoverTintBinding` / `committedHex(fromHoverBar:)` / `hoverBarStorage` are untouched.

4. **Criterion 1 holds.** One `TintEditor` at `sleepControls` (`offersNoTint: false`) and `hoverbarSection` (default true). Hoverbar path unchanged.

5. **No new findings.** Deleted expects that `committedHex("")` / `"none"` equalled graphite follow from the fix; they were the skip bug. New tests pin nil, rewrite of unusable, and skip of `"gray"`/`"grey"`/`"purple"`/`#8e8e93`/`#3311aa`.

6. No `needs adjudication`.
