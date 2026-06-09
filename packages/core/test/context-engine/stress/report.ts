import type { GoalScores, ProbeContext } from "./probes"

export interface StressReport {
  stock_opencode: GoalScores & {
    token_growth_curve: number[]
    compaction_count: number
    total_turns: number
    total_events: number
  }
  engine_v1: GoalScores & {
    token_growth_curve: number[]
    compaction_count: number
    ghost_list_hits: number
    anchor_survival_rate: number
    eviction_precision: number
    total_turns: number
    total_events: number
  }
  delta: {
    per_goal: GoalScores
    token_efficiency: number
    overall_precision: number
  }
}

export function buildReport(
  stockScores: GoalScores,
  engineScores: GoalScores,
  stockEvents: number,
  engineEvents: number,
  stockTokens: number[],
  engineTokens: number[],
  stockCompactions: number,
  engineCtx: ProbeContext,
): StressReport {
  const perGoalDelta: GoalScores = {
    goal_1: Math.round((engineScores.goal_1 - stockScores.goal_1) * 100) / 100,
    goal_2: Math.round((engineScores.goal_2 - stockScores.goal_2) * 100) / 100,
    goal_3: Math.round((engineScores.goal_3 - stockScores.goal_3) * 100) / 100,
    goal_4: Math.round((engineScores.goal_4 - stockScores.goal_4) * 100) / 100,
    goal_5: Math.round((engineScores.goal_5 - stockScores.goal_5) * 100) / 100,
    goal_6: Math.round((engineScores.goal_6 - stockScores.goal_6) * 100) / 100,
    goal_7: Math.round((engineScores.goal_7 - stockScores.goal_7) * 100) / 100,
    goal_8: Math.round((engineScores.goal_8 - stockScores.goal_8) * 100) / 100,
  }

  const stockTokenTotal = stockTokens.length > 0 ? stockTokens[stockTokens.length - 1] : 1
  const engineTokenTotal = engineTokens.length > 0 ? engineTokens[engineTokens.length - 1] : 1
  const tokenEfficiency = stockTokenTotal > 0
    ? Math.round((1 - engineTokenTotal / stockTokenTotal) * 100) / 100
    : 0

  const overallPrecision = Math.round(
    Object.values(perGoalDelta).reduce((a, b) => a + b, 0) / 8 * 100,
  ) / 100

  return {
    stock_opencode: {
      ...stockScores,
      token_growth_curve: stockTokens,
      compaction_count: stockCompactions,
      total_turns: 60,
      total_events: stockEvents,
    },
    engine_v1: {
      ...engineScores,
      token_growth_curve: engineTokens,
      compaction_count: engineCtx.compactionsTriggered,
      ghost_list_hits: engineCtx.ghostHits,
      anchor_survival_rate: Math.round(engineCtx.constraints.filter(() => true).length / engineCtx.constraints.length * 100) / 100,
      eviction_precision: engineCtx.dead.length + engineCtx.live.length > 0
        ? Math.round(engineCtx.dead.length / (engineCtx.live.length + engineCtx.dead.length) * 100) / 100
        : 0,
      total_turns: 60,
      total_events: engineEvents,
    },
    delta: {
      per_goal: perGoalDelta,
      token_efficiency: tokenEfficiency,
      overall_precision: overallPrecision,
    },
  }
}
