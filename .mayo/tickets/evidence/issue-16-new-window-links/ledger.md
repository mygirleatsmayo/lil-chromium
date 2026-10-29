# Findings ledger — issue #16 (new-window links)

Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` · Reviewed code: `b43cdfe0d50918c4b5a2d8ab492ecd61661aabb2`.

Review round 1 (full, two-axis): Standards `ol_RmvBJ` (`cursor-grok-4.6-medium`), Spec `7yPiEHMW` (`cursor-grok-4.6-medium`).

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Findings

| ID | Axis | Location | Verdict | Settled interpretation |
|---|---|---|---|---|
| S1 | Standards | Repeated setup across the new requested-target behavior tests | **won't fix — low-value test-only cleanup** | Each case keeps its setup and expected lifecycle visible. Extracting a broader helper would trade local repetition for indirection without changing production behavior or coverage; revisit only if this setup continues growing. |

## Round 1 outcome

No production, protocol, or Spec fix is owed. Opener-less normal-window targets, popup/OAuth preservation, settle behavior, modifier isolation, focus/prior-context behavior, and issue #18 ownership passed.
