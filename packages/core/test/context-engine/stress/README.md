# Context Engine Stress Test Suite

Comprehensive automated stress test for the OpenCode Context Engine. Runs both stock OpenCode (all engine flags off) and the engine (all flags on) against an identical 60-turn session and produces a quantifiable comparison report.

## Quick start

```bash
bun test --cwd packages/core ./test/context-engine/stress/stress.test.ts
```

## What it tests (8 goals)

| Goal | What | Score range |
|---|---|---|
| 1 — Constraint Persistence | 8 constraints set at session start, probed at turns 20/40/60 | 0–1 |
| 2 — Multi-File Dependency Tracking | 12+ files with dependencies, probed at turns 15/30/45/60 | 0–1 |
| 3 — Decision Reversal Detection | JWT decision at turn 5 vs session middleware at turn 35 | 0–2 |
| 4 — Compaction Degradation | 3 forced compactions with large outputs, fact retention measured | 0–1 |
| 5 — Ghost List Recovery | Deep file read at turn 10, evicted, re-needed at turn 45 | 0–2 |
| 6 — Parallel Sub-Task Coherence | 3 interleaved sub-tasks on auth module | 0–1 |
| 7 — Late-Session Precision | Same task at turn 10 vs turn 60, score delta | -1–1 |
| 8 — Context Rot Resistance | 30+ garbage events injected, eviction precision measured | 0–1 |

## Report format

```json
{
  "stock_opencode": {
    "goal_1_score": 0.0,
    "goal_2_score": 0.0,
    ...
    "token_growth_curve": [turn: tokens],
    "compaction_count": 3,
    "total_turns": 60
  },
  "engine_v1": {
    "goal_1_score": 0.0,
    ...
    "ghost_list_hits": 2,
    "anchor_survival_rate": 0.0,
    "eviction_precision": 0.0
  },
  "delta": {
    "per_goal": { ... },
    "token_efficiency": 0.0,
    "overall_precision": 0.0
  }
}
```

## Reproducibility

Uses a seeded PRNG (seed=42) for deterministic event generation. All file edits, tool calls, and probes are deterministic. Running the same test twice produces identical scores.

## Adding a real LLM judge (future)

The current probes use deterministic scoring against the event log content. To add a real judge:

1. Export the event log as a transcript
2. Send probe questions to an LLM
3. Parse judge responses into numeric scores
4. Feed scores back into the report

See `tests/stress/harness.ts` — the `runAllProbes` function is the integration point.

## File structure

```
test/context-engine/stress/
├── generator.ts    # Seeded event stream generator (60 turns, 16 files)
├── probes.ts       # 8 probe scoring functions
├── harness.ts      # Test harness: stock vs engine pipeline
├── report.ts       # Comparison report builder
├── stress.test.ts  # Bun test runner
└── README.md       # This file
```
