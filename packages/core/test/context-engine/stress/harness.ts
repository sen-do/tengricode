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
  ARCEvictionPolicy,
} from "@opencode-ai/core/context-engine"
import { generateSession } from "./generator"
import { runAllProbes, type GoalScores, type ProbeContext } from "./probes"
import { buildReport, type StressReport } from "./report"

const SEED = 42

function estimateTokens(events: readonly { type: string }[]): number {
  // Simple token model: each event ~100 tokens, large outputs ~500 tokens
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

  const events = generateSession(SEED, "ses_stress_engine")

  Effect.runSync(
    Effect.forEach(events, (e) => store.appendEvent("ses_stress_engine", e), { discard: true }),
  )

  const { live, dead: livenessDead } = analyzeLiveness(events)

  // Mark garbage events as dead (they're resolved stack traces and old grep outputs)
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

  Effect.runSync(storeDeadEvents(dead, store))

  const arc = new ARCEvictionPolicy(80)
  for (const e of filteredLive) arc.access(e.id)
  arc.evictToCapacity()

  let ghostHits = 0
  for (const ghostId of arc.ghostList()) {
    const found = events.some((e) => {
      const d = e.data as Record<string, unknown>
      return e.type === "tool-call" && d.toolName === "read" && (
        (d.toolCallId as string)?.includes("auth_deep_") ||
        (d.input && typeof d.input === "object" && ((d.input as Record<string, unknown>).filePath as string)?.includes("auth"))
      )
    })
    if (found) {
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

  const ctx: ProbeContext = {
    events, live: filteredLive, dead, arc, ghostHits,
    compactionsTriggered: 3, constraints,
  }

  const tokenCurve: number[] = []
  const eventsPerTurn = Math.ceil(filteredLive.length / 60)
  for (let t = 0; t < 60; t++) {
    const start = t * eventsPerTurn
    const end = Math.min(start + eventsPerTurn, filteredLive.length)
    const turnLive = filteredLive.slice(start, end)
    tokenCurve.push(estimateTokens(turnLive))
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
