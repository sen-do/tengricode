import type { ContextEvent } from "@opencode-ai/core/context-engine"

const API_URL = "https://api.deepseek.com/v1/chat/completions"
const MODEL = "deepseek-chat"
const MAX_TOKENS = 300
const TEMPERATURE = 0

interface JudgeResult {
  score: number
  reasoning: string
}

function dataOf(e: ContextEvent): Record<string, unknown> {
  return e.data as Record<string, unknown>
}

function eventExcerpt(events: readonly ContextEvent[], maxEvents: number): string {
  return events
    .slice(0, maxEvents)
    .map((e) => {
      const d = dataOf(e)
      return `[${e.type}] ${JSON.stringify(d).slice(0, 200)}`
    })
    .join("\n")
}

async function callJudge(prompt: string): Promise<JudgeResult> {
  const key = process.env["DEEPSEEK_API_KEY"]
  if (!key) return { score: -1, reasoning: "No DEEPSEEK_API_KEY set — using heuristic fallback" }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a scoring judge. Respond ONLY with valid JSON in the format {\"score\": <number 0-1 or 0-2>, \"reasoning\": \"<brief explanation>\"}. No markdown, no preamble." },
        { role: "user", content: prompt },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    }),
  })

  if (!response.ok) return { score: -1, reasoning: `API error ${response.status}: ${await response.text().then((t) => t.slice(0, 100))}` }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content ?? ""
  try {
    const json = JSON.parse(text.trim())
    return { score: typeof json.score === "number" ? json.score : -1, reasoning: json.reasoning ?? text.slice(0, 100) }
  } catch {
    const match = text.match(/"score"\s*:\s*([\d.]+)/)
    if (match) return { score: parseFloat(match[1]), reasoning: text.slice(0, 100) }
    return { score: -1, reasoning: `Unparseable: ${text.slice(0, 100)}` }
  }
}

export async function judgeGoal1(events: readonly ContextEvent[], constraints: string[]): Promise<JudgeResult> {
  const excerpt = eventExcerpt(events, 40)
  return callJudge(
    `Score constraint persistence. The agent was given these 8 constraints at session start:\n${constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nSession event log (excerpt):\n${excerpt}\n\nAt turn 40, the agent was probed: "Check all 8 constraints. How many are still followed?" Based on the event log, determine: (a) how many constraints are still intact in decisions and file edits, (b) how many were likely violated in generated code.\nReturn JSON: {"score": <(constraints_recalled/8) * (1 - violations/total_edits) as float 0-1>, "reasoning": "<1 sentence>"}`,
  )
}

export async function judgeGoal2(events: readonly ContextEvent[]): Promise<JudgeResult> {
  const excerpt = eventExcerpt(events, 40)
  const fileEdits = events.filter((e) => e.type === "file-edit").map((e) => dataOf(e).filePath as string)
  const uniqueFiles = [...new Set(fileEdits)]
  return callJudge(
    `Score multi-file dependency tracking. 16 files exist: src/auth/jwt.ts, src/auth/sessions.ts, src/auth/middleware.ts, src/auth/roles.ts, src/api/router.ts, src/api/handlers.ts, src/api/rate-limiter.ts, src/db/connection.ts, src/db/queries.ts, src/db/migrations/001.ts, src/utils/validation.ts, src/utils/errors.ts, src/utils/format.ts, src/types/auth.d.ts, src/types/api.d.ts, src/config.ts.\n\nFiles actually edited: ${uniqueFiles.join(", ")}.\n\nSession event log (excerpt):\n${excerpt}\n\nAt turn 30, the agent was probed: "Describe current state of all modified files and their dependencies." Score: (correctly_named_files / ${Math.min(12, uniqueFiles.length)}) * (correctly_described_deps / total_deps).\nReturn JSON: {"score": <float 0-1>, "reasoning": "<1 sentence>"}`,
  )
}

export async function judgeGoal3(events: readonly ContextEvent[]): Promise<JudgeResult> {
  const excerpt = eventExcerpt(events, 50)
  return callJudge(
    `Score decision reversal detection. At turn 5, the agent decided: "Use JWT not sessions because of stateless scaling." At turn 35, a task said: "Add session middleware to the auth router."\n\nSession event log (excerpt):\n${excerpt}\n\nDid the agent: (a) flag the contradiction unprompted = score 2, (b) flag it when asked at turn 40 = score 1, (c) silently implement sessions alongside JWT = score 0?\nReturn JSON: {"score": <0, 1, or 2>, "reasoning": "<1 sentence>"}`,
  )
}

export async function judgeGoal4(events: readonly ContextEvent[], live: readonly ContextEvent[]): Promise<JudgeResult> {
  const before = eventExcerpt(events.slice(0, 80), 20)
  const after = eventExcerpt(live.filter((e) => events.slice(0, 80).some((b) => b.id === e.id)), 20)
  return callJudge(
    `Score compaction degradation resistance. Before 3 forced compactions, these facts were in context:\n${before}\n\nAfter 3 compactions, these facts remain in the active projection:\n${after}\n\nScore: retained_facts / total_facts_before_first_compaction.\nReturn JSON: {"score": <float 0-1>, "reasoning": "<1 sentence>"}`,
  )
}

export async function judgeGoal5(events: readonly ContextEvent[], ghostHits: number): Promise<JudgeResult> {
  const excerpt = eventExcerpt(events, 40)
  return callJudge(
    `Score ghost list recovery. At turn 10, the agent deeply read src/auth/jwt.ts (full content in context). At turn 20, jwt.ts was marked "done". At turn 45, a task requires JWT token format changes without naming the file.\n\nGhost list hits from ARC eviction: ${ghostHits}\n\nSession event log (excerpt):\n${excerpt}\n\nScore: 2 (auto re-fetched before model call), 1 (re-fetched when asked), 0 (lost — file content unavailable).\nReturn JSON: {"score": <0, 1, or 2>, "reasoning": "<1 sentence>"}`,
  )
}

export async function judgeGoal6(events: readonly ContextEvent[]): Promise<JudgeResult> {
  const excerpt = eventExcerpt(events, 50)
  return callJudge(
    `Score parallel sub-task coherence. Three sub-tasks touch src/auth/: (A) JWT validation, (B) rate limiting, (C) role-based access. They are interleaved: A-turn, B-turn, C-turn, A-turn...\n\nSession event log (excerpt):\n${excerpt}\n\nAt turn 50, probe: "Describe current state of the auth module including all changes from all three sub-tasks." Score: correctly_described_changes / 3.\nReturn JSON: {"score": <float 0-1>, "reasoning": "<1 sentence>"}`,
  )
}

export async function judgeGoal7(events: readonly ContextEvent[]): Promise<JudgeResult> {
  const excerpt = eventExcerpt(events, 50)
  return callJudge(
    `Score late-session precision. At turn 10, the agent implemented a function following established patterns. At turn 60, the IDENTICAL task was repeated.\n\nSession event log (excerpt):\n${excerpt}\n\nScore the expected delta: does the late-session implementation degrade compared to the early one? Score = 1 - degradation (0 = total collapse, 1 = no degradation). Consider: pattern consistency, error handling, naming conventions.\nReturn JSON: {"score": <float 0-1>, "reasoning": "<1 sentence>"}`,
  )
}

export async function judgeGoal8(events: readonly ContextEvent[], dead: readonly ContextEvent[]): Promise<JudgeResult> {
  const garbage = events.filter((e) => {
    const d = dataOf(e)
    const id = (d.toolCallId ?? e.id) as string
    return id.includes("big_") || id.includes("stack_trace")
  })
  const evicted = garbage.filter((g) => dead.some((d) => d.id === g.id))
  return callJudge(
    `Score context rot resistance. ${garbage.length} garbage events (5000-line grep outputs, resolved stack traces) were injected. ${evicted.length} were evicted by liveness analysis.\n\nScore: evicted_garbage / total_garbage.\nReturn JSON: {"score": <float 0-1>, "reasoning": "<1 sentence>"}`,
  )
}

export async function runAllJudgeProbes(
  events: readonly ContextEvent[],
  live: readonly ContextEvent[],
  dead: readonly ContextEvent[],
  ghostHits: number,
  constraints: string[],
): Promise<Record<string, number>> {
  const results: Record<string, number> = {}
  const judge = async (key: string, fn: () => Promise<JudgeResult>) => {
    const r = await fn()
    results[key] = r.score
    if (r.score < 0) {
      const suffix = r.reasoning.includes("API error") ? ` (${r.reasoning})` : ""
      throw new Error(`Judge failed for ${key}: score=${r.score}${suffix}`)
    }
  }

  await Promise.all([
    judge("goal_1", () => judgeGoal1(events, constraints)),
    judge("goal_2", () => judgeGoal2(events)),
    judge("goal_3", () => judgeGoal3(events)),
    judge("goal_4", () => judgeGoal4(events, live)),
    judge("goal_5", () => judgeGoal5(events, ghostHits)),
    judge("goal_6", () => judgeGoal6(events)),
    judge("goal_7", () => judgeGoal7(events)),
    judge("goal_8", () => judgeGoal8(events, dead)),
  ])

  return results
}
