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

## Verdict

Open. S1/S2 await Lucas's decision on whether `docs/PROTOCOL.md` and `extension/background.js` move to Startpage.
