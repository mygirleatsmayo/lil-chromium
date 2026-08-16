# Findings ledger — Issue #10: Make search providers durable and Startpage-first

Branch `v0.4/issue-10-search-providers`. Fixed point `main` @ `4a4ada8`. Code at `d861709`.

Round 1 review: Standards `LKuwuIsz` (2 findings), Spec `ysPn3nnF` (no findings).

## Findings

| ID | Quote / location | Verdict | Settled interpretation |
|---|---|---|---|
| S1 | `Config.swift:107-108` — `name: String = SearchProviders.startpage.name` / `template: String = SearchProviders.startpageTemplate` | **pending adjudication** | The default moved to Startpage in `mac/` only. `docs/PROTOCOL.md:41-44,64` still documents Google as the built-in default. |
| S2 | `Config.swift:100-103` — `public var provider: String` / `case name, template, provider`; `SearchProviders.swift:59-60` — `google, duckDuckGo, bing, kagi, startpage, custom` | **pending adjudication** | A new `provider` key ships on the `get-context` wire and the preset list gained Startpage; `docs/PROTOCOL.md:61` documents neither. |
| P1–P9 | all nine acceptance criteria | **met** | Spec review verified each with quoted code. Settled: the implementation satisfies Issue #10 as written. |

S1 and S2 have one root cause: `AGENTS.md` requires a contract change to land in `mac/`, `extension/`, and `docs/PROTOCOL.md` together or none. This one landed in `mac/` alone.

## Manager verification

Every factual claim in the Standards report was checked directly:

| Claim | Verified |
|---|---|
| `docs/PROTOCOL.md:41-44` config example shows `"name": "Google"` | yes |
| `docs/PROTOCOL.md:61` presets = Google, DuckDuckGo, Bing, Kagi, Custom — no Startpage | yes |
| `docs/PROTOCOL.md:64` "Missing file/fields → built-in defaults above" | yes |
| `extension/background.js:73` `DEFAULT_SEARCH` = Google | yes |

**Correction to S1's failure scenario.** S1 claims palette and hoverbar disagree. They do not, in practice: `background.js:1438` uses `ctx.searchEngine.template` when context is present, so the hoverbar follows the native Startpage default as soon as context arrives. Google appears only when context is missing entirely. The documentation divergence in S2 is the solid finding; S1's user-visible failure is a thin edge case. Recorded so no later round treats S1's stated scenario as proven.

## Settled interpretations

1. The implementer deliberately did not rewrite `docs/PROTOCOL.md`, on the grounds that it is Lucas's human-facing prose and a contract change spans three components. That restraint was correct, not an omission.
2. Provider selection is stored explicit state; inferring it from the current template is a regression and may not be reintroduced.
3. The Custom draft is separate from the committed template. A round that makes an invalid draft rewrite config or switch provider fails.

## Owner decision (2026-08-16)

Lucas chose to move the documented default to Startpage rather than revert the code, and confirmed the decision covers every place it reaches: "yes, startpage."

## Fix rounds

| Commit | What |
|---|---|
| `faf8321` | `docs/PROTOCOL.md` schema example, preset list, `provider` documented; `extension/background.js` `DEFAULT_SEARCH`; one honest expectation update in `extension/test/worker.test.js` |
| `f7111bb` | `extension/overlay.js:235,794` hoverbar fallback and display name |
| `a01a742` | `docs/PROTOCOL.md:142` hover-bar prose; `README.md:80` preset list |

Round 2 remediation review `vy-Ar5Lq`: S1 and S2 **resolved**, no new defects. It ruled the `worker.test.js` edit honest — `fixtures/config-v1-legacy.json` carries no `searchEngine`, so the new literals come from the native missing-field defaults, not from `DEFAULT_SEARCH`.

Round 4 final full review: Standards `Up1IYw8T` and Spec `2j2809oe`, both **no findings**. All nine criteria met with quoted proof; the three-component contract confirmed in both directions.

## Declined

- The extension's `DEFAULT_SEARCH` and `normalizeContext` do not carry the new `provider` key. Not fixed: the palette and hoverbar consume `name` and `template` only, and that object is the extension's local fallback rather than the documented config. An unused field would be noise.

## Noted, not in scope

`mac/Sources/LilChromiumApp/URLIntent.swift:45` — `googleSearchURL(_:)` hardcodes Google and has no callers (verified by grep across `mac/`). Dead code, not a live default. Left for a separate cleanup.

## Verdict

**Closed.** Ledger fully resolved; final full review clean on both axes.
