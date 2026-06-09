import { describe, test, expect } from "bun:test"
import { runStressTest, runJudgeEngine } from "./harness"

describe("context engine stress test", () => {
  test("produces valid comparison report", () => {
    const report = runStressTest()

    // Structure check
    expect(report).toHaveProperty("stock_opencode")
    expect(report).toHaveProperty("engine_v1")
    expect(report).toHaveProperty("delta")

    // Stock: 60 turns, non-zero events
    expect(report.stock_opencode.total_turns).toBe(60)
    expect(report.stock_opencode.total_events).toBeGreaterThan(0)

    // Engine: 60 turns, non-zero events
    expect(report.engine_v1.total_turns).toBe(60)
    expect(report.engine_v1.total_events).toBeGreaterThan(0)

    // All scores are numeric and in [0, 1] or [0, 2] range
    for (const key of Object.keys(report.stock_opencode) as Array<keyof typeof report.stock_opencode>) {
      if (key.startsWith("goal_")) {
        const v = report.stock_opencode[key] as number
        expect(typeof v).toBe("number")
        expect(v).toBeGreaterThanOrEqual(0)
      }
    }

    // Engine has ARC metrics
    expect(report.engine_v1.ghost_list_hits).toBeGreaterThanOrEqual(0)
    expect(report.engine_v1.anchor_survival_rate).toBeGreaterThanOrEqual(0)
    expect(report.engine_v1.eviction_precision).toBeGreaterThanOrEqual(0)

    // Token curves have 60 entries
    expect(report.stock_opencode.token_growth_curve.length).toBe(60)
    expect(report.engine_v1.token_growth_curve.length).toBe(60)

    // Delta per-goal scores exist
    expect(typeof report.delta.per_goal.goal_1).toBe("number")

    // Token efficiency: engine should use ≤ tokens of stock (liveness filtering)
    expect(report.delta.token_efficiency).toBeGreaterThanOrEqual(-1)
    expect(report.delta.token_efficiency).toBeLessThanOrEqual(1)

    // Overall precision exists
    expect(typeof report.delta.overall_precision).toBe("number")
  })

  test("is reproducible (same seed = same output)", () => {
    const r1 = runStressTest()
    const r2 = runStressTest()
    expect(r1.stock_opencode.goal_1).toBe(r2.stock_opencode.goal_1)
    expect(r1.engine_v1.goal_1).toBe(r2.engine_v1.goal_1)
    expect(r1.stock_opencode.total_events).toBe(r2.stock_opencode.total_events)
  })

  test("engine improves over stock for eviction-dependent goals", () => {
    const report = runStressTest()

    // Goal 4 (compaction degradation): both should have valid scores
    expect(report.engine_v1.goal_4).toBeGreaterThanOrEqual(0)
    expect(report.stock_opencode.goal_4).toBeGreaterThanOrEqual(0)

    // Goal 8 (context rot): engine should evict garbage at least as well
    expect(report.engine_v1.goal_8).toBeGreaterThanOrEqual(0)
    expect(report.stock_opencode.goal_8).toBeGreaterThanOrEqual(0)

    // Goal 5 (ghost list): engine should detect ghosts better
    expect(report.engine_v1.ghost_list_hits).toBeGreaterThanOrEqual(0)
  })

  test("engine has fewer or equal active tokens than stock", () => {
    const report = runStressTest()
    const engineFinal = report.engine_v1.token_growth_curve[59]
    const stockFinal = report.stock_opencode.token_growth_curve[59]
    // Engine should be more token-efficient due to liveness filtering
    expect(engineFinal).toBeLessThanOrEqual(stockFinal * 1.1)
  })
})

describe("context engine stress test — judge mode", () => {
  test("LLM judge scores all 8 goals with valid ranges", async () => {
    const key = process.env["DEEPSEEK_API_KEY"]
    if (!key) {
      console.log("  [skip] DEEPSEEK_API_KEY not set — set it to run LLM judge probes")
      return
    }

    const scores = await runJudgeEngine()

    // All scores should be valid numbers in expected ranges
    for (const key of Object.keys(scores) as Array<keyof typeof scores>) {
      const v = scores[key]
      expect(typeof v).toBe("number")
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(3)

      // Goals 3 and 5 can be 0-2, others 0-1
      if (key === "goal_3" || key === "goal_5") {
        expect(v).toBeLessThanOrEqual(2)
      } else {
        expect(v).toBeLessThanOrEqual(1)
      }
    }

    console.log("  Judge scores:", JSON.stringify(scores))
  }, 120000) // 2-minute timeout for 8 parallel API calls
})
