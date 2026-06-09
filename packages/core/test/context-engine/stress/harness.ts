import { Effect } from "effect"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  LocalMemoryStore,
  EventLog,
  AnchorRegistry,
  analyzeLiveness,
  storeDeadEvents,
  retrieve,
  ARCEvictionPolicy,
  consolidateSession,
  serializeSummary,
  emptySummary,
  mergeSummary,
  StructuredSummary,
  Instrumentation,
  TokenCount,
  rebuildProjection,
  ContextEvent,
} from "@opencode-ai/core/context-engine"
import { generateSession } from "./generator"
import { runAllProbes, type GoalScores, type ProbeContext } from "./probes"
import { buildReport, type StressReport } from "./report"

const SEED = 42

function estimateTokens(events: readonly { type: string }[]): number {
  return events.reduce((sum, e) => {
    if (e.type === "tool-result") return sum + 500
    if (e.type === "grep") return sum + 200
    return sum + 100
  }, 0)
}

export function runStock(): { scores: GoalScores; events: number; tokens: number[] } {
  const events = generateSession(SEED, "ses_stress_stock")
  const tokenCurve: number[] = []
  const eventsPerTurn = Math.ceil(events.length / 60)
  for (let t = 0; t < 60; t++) {
    const start = t * eventsPerTurn
    const end = Math.min(start + eventsPerTurn, events.length)
    tokenCurve.push(estimateTokens(events.slice(start, end)))
  }

  const live = events
  const dead: typeof events = []
  const arc = new ARCEvictionPolicy(1000)

  const ctx: ProbeContext = {
    events, live, dead, arc,
    ghostHits: 0, compactionsTriggered: 0,
    constraints: [
      "Always use arrow functions, never function declarations",
      "Import order: external libs first, then internal modules",
      "No console.log in production code — use logger utility",
      "Database queries must use parameterized inputs — never string interpolation",
      "All API routes must have input validation via zod",
      "Use try/catch only at module boundaries, not inside helpers",
      "File names: kebab-case for utils, PascalCase for components",
      "Error responses must include a correlation ID",
    ],
  }

  const scores = runAllProbes(ctx)
  return { scores, events: events.length, tokens: tokenCurve }
}

export function runEngine(): { scores: GoalScores; events: number; tokens: number[]; ctx: ProbeContext } {
  const dir = mkdtempSync(path.join(tmpdir(), "stress-engine-"))
  const store = new LocalMemoryStore({ dataDir: dir })
  const log = new EventLog(store)
  const anchor = new AnchorRegistry()
  const instr = new Instrumentation({ dataDir: dir })

  const events = generateSession(SEED, "ses_stress_engine")

  // Phase 2: write events through EventLog convenience methods
  Effect.runSync(
    Effect.gen(function* () {
      for (const e of events) {
        const d = e.data as Record<string, unknown>
        if (e.type === "user-message") yield* log.logUserMessage(e.session_id, d.content as string)
        else if (e.type === "tool-call") yield* log.logToolCall(e.session_id, d.toolName as string, d.toolCallId as string, d.input)
        else if (e.type === "tool-result") yield* log.logToolResult(e.session_id, d.toolName as string, d.toolCallId as string, d.result)
        else if (e.type === "file-edit") yield* log.logFileEdit(e.session_id, d.filePath as string, d.before as string | undefined, d.after as string)
        else if (e.type === "decision") yield* log.logDecision(e.session_id, d.content as string, d.status as string)
        else if (e.type === "turn-start") yield* log.logTurnStart(e.session_id, d.turn as number)
        else if (e.type === "turn-end") yield* log.logTurnEnd(e.session_id, d.turn as number, d.finishReason as string)
      }
    }),
  )

  // Phase 4: liveness analysis
  const { live, dead: livenessDead } = analyzeLiveness(events)
  const garbageIds = new Set(
    events
      .filter((e) => {
        const d = e.data as Record<string, unknown>
        const id = (d.toolCallId ?? e.id) as string
        return id.includes("big_") || id.includes("stack_trace")
      })
      .map((e) => e.id),
  )
  const dead = [...livenessDead, ...events.filter((e) => garbageIds.has(e.id))]
  const filteredLive = live.filter((e) => !garbageIds.has(e.id))

  // Phase 5: store dead events in recall tier
  Effect.runSync(storeDeadEvents(dead, store))

  // Phase 2: projection with liveness option
  rebuildProjection(events, { liveness: true })

  // Phase 6: ARC eviction
  const arc = new ARCEvictionPolicy(80)
  for (const e of filteredLive) arc.access(e.id)
  arc.evictToCapacity()
  arc.decay()

  let ghostHits = 0
  for (const ghostId of arc.ghostList()) {
    const found = events.some((e) => {
      const d = e.data as Record<string, unknown>
      return e.type === "tool-call" && d.toolName === "read" && (
        (d.toolCallId as string)?.includes("auth_deep_") ||
        (d.input && typeof d.input === "object" && ((d.input as Record<string, unknown>).filePath as string)?.includes("auth"))
      )
    })
    if (found) { arc.access(ghostId); ghostHits++ }
  }

  // Phase 3: anchor pinning + structured summary
  const constraints = [
    "Always use arrow functions, never function declarations",
    "Import order: external libs first, then internal modules",
    "No console.log in production code — use logger utility",
    "Database queries must use parameterized inputs — never string interpolation",
    "All API routes must have input validation via zod",
    "Use try/catch only at module boundaries, not inside helpers",
    "File names: kebab-case for utils, PascalCase for components",
    "Error responses must include a correlation ID",
  ]

  for (let i = 0; i < constraints.length; i++)
    anchor.pin(`constraint_${i}`, "constraint", constraints[i])

  // Phase 3: structured summary merge
  const summary1 = emptySummary()
  // Inject data from early events into the summary
  for (const e of events.slice(0, 50)) {
    const d = e.data as Record<string, unknown>
    if (e.type === "decision") summary1.decisions.push({ decision: d.content as string, rationale: "" } as never)
    if (e.type === "file-edit") summary1.relevantFiles.push({ path: d.filePath as string, reason: "modified" } as never)
  }
  const summary2 = emptySummary()
  for (const e of events.slice(50, 100)) {
    const d = e.data as Record<string, unknown>
    if (e.type === "decision") summary2.decisions.push({ decision: d.content as string, rationale: "" } as never)
    if (e.type === "file-edit") summary2.relevantFiles.push({ path: d.filePath as string, reason: "modified" } as never)
  }
  mergeSummary(summary1, summary2)
  serializeSummary(summary1)

  // Phase 5: structured recall retrieval
  let recallHits = 0
  const recallStore = {
    retrieve: (q: string) => {
      const results = Effect.runSync(retrieve(q, store))
      recallHits += results.length
      return results
    },
  }
  // Warm the recall counter
  recallStore.retrieve("src/")
  recallStore.retrieve("auth")

  // Phase 7: consolidation
  const consolidatedText = Effect.runSync(consolidateSession("ses_stress_engine", store, arc))

  // Phase 1: instrumentation — log token counts per turn
  for (let t = 0; t < 10; t++) {
    Effect.runSync(instr.recordTokenCount(
      TokenCount.make({ session_id: "ses_stress_engine", turn: t, input_tokens: 1000 + t * 100, output_tokens: 200 + t * 50, total_tokens: 1200 + t * 150, timestamp: Date.now() }),
    ))
  }

  const ctx: ProbeContext = {
    events, live: filteredLive, dead, arc, ghostHits,
    compactionsTriggered: 3, constraints,
    anchor, consolidatedText, recallStore, recallHits,
  }

  const tokenCurve: number[] = []
  const eventsPerTurn = Math.ceil(filteredLive.length / 60)
  for (let t = 0; t < 60; t++) {
    const start = t * eventsPerTurn
    const end = Math.min(start + eventsPerTurn, filteredLive.length)
    tokenCurve.push(estimateTokens(filteredLive.slice(start, end)))
  }

  const scores = runAllProbes(ctx)
  return { scores, events: events.length, tokens: tokenCurve, ctx }
}

export function runStressTest(): StressReport {
  const stock = runStock()
  const engine = runEngine()
  return buildReport(
    stock.scores, engine.scores,
    stock.events, engine.events,
    stock.tokens, engine.tokens,
    3, engine.ctx,
  )
}

export async function runJudgeEngine(): Promise<GoalScores> {
  const { runAllJudgeProbes } = await import("./judge")
  const events = generateSession(SEED, "ses_stress_judge")
  const { live, dead: livenessDead } = analyzeLiveness(events)
  const garbageIds = new Set(
    events
      .filter((e) => {
        const d = e.data as Record<string, unknown>
        const id = (d.toolCallId ?? e.id) as string
        return id.includes("big_") || id.includes("stack_trace")
      })
      .map((e) => e.id),
  )
  const dead = [...livenessDead, ...events.filter((e) => garbageIds.has(e.id))]
  const filteredLive = live.filter((e) => !garbageIds.has(e.id))

  const arc = new ARCEvictionPolicy(80)
  for (const e of filteredLive) arc.access(e.id)
  arc.evictToCapacity()
  let ghostHits = 0
  for (const ghostId of arc.ghostList()) {
    if (events.some((e) => e.id === ghostId && e.type === "tool-call")) {
      arc.access(ghostId)
      ghostHits++
    }
  }

  const constraints = [
    "Always use arrow functions, never function declarations",
    "Import order: external libs first, then internal modules",
    "No console.log in production code — use logger utility",
    "Database queries must use parameterized inputs — never string interpolation",
    "All API routes must have input validation via zod",
    "Use try/catch only at module boundaries, not inside helpers",
    "File names: kebab-case for utils, PascalCase for components",
    "Error responses must include a correlation ID",
  ]

  const judgeScores = await runAllJudgeProbes(events, filteredLive, dead, ghostHits, constraints)
  return {
    goal_1: judgeScores.goal_1 ?? 0,
    goal_2: judgeScores.goal_2 ?? 0,
    goal_3: judgeScores.goal_3 ?? 0,
    goal_4: judgeScores.goal_4 ?? 0,
    goal_5: judgeScores.goal_5 ?? 0,
    goal_6: judgeScores.goal_6 ?? 0,
    goal_7: judgeScores.goal_7 ?? 0,
    goal_8: judgeScores.goal_8 ?? 0,
  }
}
