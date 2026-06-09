import type { ContextEvent } from "@opencode-ai/core/context-engine"
import { analyzeLiveness, ARCEvictionPolicy } from "@opencode-ai/core/context-engine"
import { FILES, FILE_DEPS } from "./generator"

function dataOf(e: ContextEvent) { return e.data as Record<string, unknown> }

export interface GoalScores {
  goal_1: number
  goal_2: number
  goal_3: number
  goal_4: number
  goal_5: number
  goal_6: number
  goal_7: number
  goal_8: number
}

export interface ProbeContext {
  events: readonly ContextEvent[]
  live: readonly ContextEvent[]
  dead: readonly ContextEvent[]
  arc: ARCEvictionPolicy
  ghostHits: number
  compactionsTriggered: number
  constraints: string[]
}

const CONSTRAINTS = [
  "Always use arrow functions, never function declarations",
  "Import order: external libs first, then internal modules",
  "No console.log in production code — use logger utility",
  "Database queries must use parameterized inputs — never string interpolation",
  "All API routes must have input validation via zod",
  "Use try/catch only at module boundaries, not inside helpers",
  "File names: kebab-case for utils, PascalCase for components",
  "Error responses must include a correlation ID",
]

export function probeGoal1(ctx: ProbeContext): number {
  const recalled = new Set<string>()
  for (const e of ctx.live) {
    if (e.type !== "decision") continue
    const c = dataOf(e).content as string
    for (const constraint of ctx.constraints) {
      if (c.includes(constraint.slice(0, 20))) recalled.add(constraint)
    }
  }
  const constraintRecall = Math.min(1, recalled.size / ctx.constraints.length)

  let silentViolations = 0
  let totalEdits = 0
  for (const e of ctx.events) {
    if (e.type !== "file-edit") continue
    totalEdits++
  }
  silentViolations = Math.max(0, totalEdits - ctx.constraints.length * 2)
  const violationPenalty = totalEdits > 0 ? 1 - Math.min(1, silentViolations / totalEdits) : 1
  return Math.round(constraintRecall * violationPenalty * 100) / 100
}

export function probeGoal2(ctx: ProbeContext): number {
  const modifiedFiles = new Set<string>()
  for (const e of ctx.live) {
    if (e.type !== "file-edit") continue
    modifiedFiles.add(dataOf(e).filePath as string)
  }
  const known = ctx.events.filter((e) => e.type === "file-edit")
  const touched = new Set(known.map((e) => dataOf(e).filePath as string))
  const fileScore = touched.size > 0 ? modifiedFiles.size / Math.max(touched.size, 1) : 0

  let correctDeps = 0
  let totalDepsChecked = 0
  for (const f of touched) {
    const deps = FILE_DEPS[f] ?? []
    totalDepsChecked += deps.length
    for (const dep of deps) {
      if (modifiedFiles.has(dep) || touched.has(dep)) correctDeps++
    }
  }
  const depScore = totalDepsChecked > 0 ? correctDeps / totalDepsChecked : 0
  return Math.round((fileScore * 0.5 + depScore * 0.5) * 100) / 100
}

export function probeGoal3(ctx: ProbeContext): number {
  let hasJwtDecision = false
  let hasSessionEdit = false
  for (const e of ctx.events) {
    if (e.type === "decision") {
      const c = dataOf(e).content as string
      if (c.includes("JWT") && c.includes("stateless")) hasJwtDecision = true
    }
    if (e.type === "file-edit") {
      const c = (dataOf(e).after as string) ?? ""
      if (c.includes("session")) hasSessionEdit = true
    }
  }
  if (!hasJwtDecision && !hasSessionEdit) return 2
  if (hasJwtDecision && !hasSessionEdit) return 2
  if (hasJwtDecision && hasSessionEdit) return 1
  return 0
}

export function probeGoal4(ctx: ProbeContext): number {
  if (ctx.compactionsTriggered === 0) return 1
  // Use the first quarter of events (before first compaction at turn ~12)
  const cutoffIdx = Math.floor(ctx.events.length * 0.2)
  const beforeCompaction = ctx.events.slice(0, cutoffIdx)
  const afterCompaction = ctx.live.filter((e) =>
    beforeCompaction.some((b) => b.id === e.id),
  )
  const infoBefore = beforeCompaction.filter((e) =>
    e.type === "tool-result" || e.type === "tool-call",
  ).length
  const infoRetained = afterCompaction.filter((e) =>
    e.type === "tool-result" || e.type === "tool-call",
  ).length
  return infoBefore > 0 ? Math.round((infoRetained / infoBefore) * 100) / 100 : 0
}

export function probeGoal5(ctx: ProbeContext): number {
  const deepRead = ctx.events.find((e) =>
    e.type === "tool-call" && (dataOf(e).toolCallId as string)?.includes("auth_deep_"),
  )
  if (!deepRead) return 0
  if (ctx.ghostHits > 0) return 2
  const inLive = ctx.live.some((e) => e.id === deepRead.id)
  const inGhost = ctx.arc.inGhostList(deepRead.id)
  if (inLive) return 2
  if (inGhost) return 1
  return 0
}

export function probeGoal6(ctx: ProbeContext): number {
  const authEdits = ctx.events.filter((e) =>
    e.type === "file-edit" && (dataOf(e).filePath as string)?.startsWith("src/auth/"),
  )
  const jwtEdits = authEdits.filter((e) => (dataOf(e).after as string)?.includes("JWT"))
  const rateLimitEdits = authEdits.filter((e) => (dataOf(e).after as string)?.includes("rate"))
  const rolesEdits = authEdits.filter((e) => (dataOf(e).after as string)?.includes("role"))
  const totalChanges = 3
  const found = (jwtEdits.length > 0 ? 1 : 0) + (rateLimitEdits.length > 0 ? 1 : 0) + (rolesEdits.length > 0 ? 1 : 0)
  return Math.round((found / totalChanges) * 100) / 100
}

export function probeGoal7(ctx: ProbeContext): number {
  const midIdx = Math.floor(ctx.events.length * 0.3)
  const earlyEdits = ctx.events.slice(0, midIdx).filter((e) => e.type === "file-edit")
  const lateEdits = ctx.events.slice(-midIdx).filter((e) => e.type === "file-edit")
  const earlyScore = Math.min(1, earlyEdits.length / 3)
  const lateScore = Math.min(1, lateEdits.length / 3)
  const delta = lateScore - earlyScore
  return Math.round((1 + delta) * 100) / 100
}

export function probeGoal8(ctx: ProbeContext): number {
  const garbageEvents = ctx.events.filter((e) => {
    const d = dataOf(e)
    const id = (d.toolCallId ?? e.id) as string
    return id.includes("big_") || id.includes("stack_trace")
  })
  if (garbageEvents.length === 0) return 1
  const evictedGarbage = garbageEvents.filter((e) =>
    ctx.dead.some((d) => d.id === e.id) || !ctx.live.some((l) => l.id === e.id),
  )
  return Math.round((evictedGarbage.length / garbageEvents.length) * 100) / 100
}

export function runAllProbes(ctx: ProbeContext): GoalScores {
  return {
    goal_1: probeGoal1(ctx),
    goal_2: probeGoal2(ctx),
    goal_3: probeGoal3(ctx),
    goal_4: probeGoal4(ctx),
    goal_5: probeGoal5(ctx),
    goal_6: probeGoal6(ctx),
    goal_7: probeGoal7(ctx),
    goal_8: probeGoal8(ctx),
  }
}

export function zeroScores(): GoalScores {
  return { goal_1: 0, goal_2: 0, goal_3: 0, goal_4: 0, goal_5: 0, goal_6: 0, goal_7: 0, goal_8: 0 }
}

export function avgScores(a: GoalScores, b: GoalScores): GoalScores {
  return {
    goal_1: Math.round((a.goal_1 + b.goal_1) / 2 * 100) / 100,
    goal_2: Math.round((a.goal_2 + b.goal_2) / 2 * 100) / 100,
    goal_3: Math.round((a.goal_3 + b.goal_3) / 2 * 100) / 100,
    goal_4: Math.round((a.goal_4 + b.goal_4) / 2 * 100) / 100,
    goal_5: Math.round((a.goal_5 + b.goal_5) / 2 * 100) / 100,
    goal_6: Math.round((a.goal_6 + b.goal_6) / 2 * 100) / 100,
    goal_7: Math.round((a.goal_7 + b.goal_7) / 2 * 100) / 100,
    goal_8: Math.round((a.goal_8 + b.goal_8) / 2 * 100) / 100,
  }
}
