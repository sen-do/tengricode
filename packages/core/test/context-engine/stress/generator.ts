import { ContextEvent } from "@opencode-ai/core/context-engine"

export class PRNG {
  private state: number
  constructor(seed: number) { this.state = seed | 0 }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) | 0
    return (this.state >>> 0) / 4294967296
  }
  int(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min }
  pick<T>(arr: readonly T[]): T { return arr[this.int(0, arr.length - 1)] }
  shuffle<T>(arr: readonly T[]): T[] { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = this.int(0, i); [a[i], a[j]] = [a[j], a[i]] } return a }
}

export const FILES = [
  "src/auth/jwt.ts", "src/auth/sessions.ts", "src/auth/middleware.ts", "src/auth/roles.ts",
  "src/api/router.ts", "src/api/handlers.ts", "src/api/rate-limiter.ts",
  "src/db/connection.ts", "src/db/queries.ts", "src/db/migrations/001.ts",
  "src/utils/validation.ts", "src/utils/errors.ts", "src/utils/format.ts",
  "src/types/auth.d.ts", "src/types/api.d.ts", "src/config.ts",
]

export const FILE_DEPS: Record<string, string[]> = {
  "src/auth/jwt.ts": ["src/types/auth.d.ts", "src/utils/errors.ts"],
  "src/auth/sessions.ts": ["src/db/connection.ts", "src/types/auth.d.ts"],
  "src/auth/middleware.ts": ["src/auth/jwt.ts", "src/auth/sessions.ts", "src/utils/errors.ts"],
  "src/auth/roles.ts": ["src/auth/jwt.ts", "src/types/auth.d.ts"],
  "src/api/router.ts": ["src/auth/middleware.ts", "src/api/handlers.ts", "src/types/api.d.ts"],
  "src/api/handlers.ts": ["src/db/queries.ts", "src/utils/validation.ts", "src/types/api.d.ts"],
  "src/api/rate-limiter.ts": ["src/utils/errors.ts", "src/config.ts"],
  "src/db/connection.ts": ["src/config.ts"],
  "src/db/queries.ts": ["src/db/connection.ts", "src/types/auth.d.ts"],
  "src/utils/validation.ts": ["src/types/api.d.ts"],
  "src/utils/errors.ts": [],
  "src/config.ts": [],
}

export const ALL_TOOLS = ["read", "edit", "write", "bash", "glob", "grep", "apply_patch"]

const BIG_OUTPUT = "x".repeat(5000)

interface GenState {
  turn: number
  rng: PRNG
  sessionId: string
  eventIdCounter: number
  modifiedFiles: Set<string>
  openDecisions: Map<string, string>
  constraints: string[]
  compactionsTriggered: number
  injectedGarbage: number
}

export function generateSession(seed: number, sessionId: string): ContextEvent[] {
  const rng = new PRNG(seed)
  const s: GenState = {
    turn: 0, rng, sessionId, eventIdCounter: 0,
    modifiedFiles: new Set(), openDecisions: new Map(),
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
    compactionsTriggered: 0, injectedGarbage: 0,
  }

  const events: ContextEvent[] = []
  const eid = () => `evt_${++s.eventIdCounter}`
  const ts = () => Date.now() + s.eventIdCounter

  const add = (type: string, data: Record<string, unknown>) => {
    events.push(ContextEvent.make({ id: eid(), session_id: s.sessionId, type, timestamp: ts(), data }))
  }

  add("user-message", { content: "Set up the project with the following constraints. Follow them strictly." })
  for (const c of s.constraints) add("decision", { content: c, status: "in_progress" })

  for (s.turn = 1; s.turn <= 60; s.turn++) {
    add("turn-start", { turn: s.turn })
    const t = s.turn

    if (t === 5) {
      add("user-message", { content: "Implement JWT authentication — use JWT not sessions because of stateless scaling requirements." })
      add("decision", { content: "Use JWT not sessions because of stateless scaling", status: "in_progress" })
      add("tool-call", { toolName: "read", toolCallId: `jwt_read_${t}`, input: { filePath: "src/auth/jwt.ts" } })
      add("tool-result", { toolName: "read", toolCallId: `jwt_read_${t}`, result: { content: "export function sign() { return 'jwt' }" } })
      add("tool-call", { toolName: "edit", toolCallId: `jwt_edit_${t}`, input: { filePath: "src/auth/jwt.ts" } })
      add("tool-result", { toolName: "edit", toolCallId: `jwt_edit_${t}`, result: { success: true } })
      add("file-edit", { filePath: "src/auth/jwt.ts", before: "old", after: "JWT implementation with verify and sign" })
      s.modifiedFiles.add("src/auth/jwt.ts")
    }

    if (t === 10) {
      add("user-message", { content: "Read the full auth module and implement a login function following established patterns." })
      add("tool-call", { toolName: "read", toolCallId: `auth_deep_${t}`, input: { filePath: "src/auth/jwt.ts" } })
      add("tool-result", { toolName: "read", toolCallId: `auth_deep_${t}`, result: { content: "FULL FILE: export function sign(payload, secret) { const token = jwt.sign(payload, secret, { expiresIn: '1h' }); return token; } export function verify(token, secret) { return jwt.verify(token, secret); } export function decode(token) { return jwt.decode(token); }" } })
    }

    if (t === 15) {
      ["src/auth/middleware.ts", "src/auth/roles.ts", "src/api/router.ts", "src/api/handlers.ts", "src/db/connection.ts"]
        .forEach((f) => { add("tool-call", { toolName: "read", toolCallId: `read_${f}_${t}`, input: { filePath: f } }); add("tool-result", { toolName: "read", toolCallId: `read_${f}_${t}`, result: { content: `Content of ${f}` } }) })
      add("user-message", { content: "PROBE: Which files have we modified? Which are still open? What are the dependencies between them?" })
    }

    if (t === 20) {
      add("user-message", { content: "Mark jwt.ts as done." })
      add("decision", { content: "JWT authentication complete", status: "completed" })
      add("file-edit", { filePath: "src/auth/jwt.ts", before: "implementation", after: "final" })
      add("tool-call", { toolName: "bash", toolCallId: `test_jwt_${t}`, input: { command: "npm test -- jwt" } })
      add("tool-result", { toolName: "bash", toolCallId: `test_jwt_${t}`, result: { success: true } })
    }

    if (t === 25) {
      const files = rng.shuffle(FILES).slice(0, 5)
      files.forEach((f) => { add("tool-call", { toolName: "read", toolCallId: `ref_${f}_${t}`, input: { filePath: f } }); add("tool-result", { toolName: "read", toolCallId: `ref_${f}_${t}`, result: { content: `Refactored ${f}` } }) })
      const editFile = rng.pick(files)
      add("tool-call", { toolName: "edit", toolCallId: `edit_ref_${t}`, input: { filePath: editFile } })
      add("tool-result", { toolName: "edit", toolCallId: `edit_ref_${t}`, result: { success: true } })
      add("file-edit", { filePath: editFile, before: "old", after: "refactored" })
      s.modifiedFiles.add(editFile)
      add("user-message", { content: "PROBE: List all constraints. Check if recent code follows them." })
    }

    if (t === 30) {
      ["src/auth/middleware.ts", "src/api/router.ts", "src/api/rate-limiter.ts"].forEach((f) => {
        add("tool-call", { toolName: "read", toolCallId: `dep_read_${t}_${f}`, input: { filePath: f } })
      })
      add("user-message", { content: "PROBE: Describe current state of all modified files and their dependencies." })
    }

    if (t === 35) {
      add("user-message", { content: "Add session middleware to the auth router for stateful session tracking." })
      add("tool-call", { toolName: "read", toolCallId: `session_read_${t}`, input: { filePath: "src/auth/sessions.ts" } })
      add("tool-result", { toolName: "read", toolCallId: `session_read_${t}`, result: { content: "Session support placeholder" } })
      add("tool-call", { toolName: "edit", toolCallId: `session_edit_${t}`, input: { filePath: "src/auth/middleware.ts" } })
      add("tool-result", { toolName: "edit", toolCallId: `session_edit_${t}`, result: { content: "Added session middleware" } })
      add("file-edit", { filePath: "src/auth/middleware.ts", before: "JWT only", after: "JWT + sessions" })
      s.modifiedFiles.add("src/auth/middleware.ts")
    }

    if (t === 40) {
      add("user-message", { content: "PROBE: Check all 8 constraints. How many are still followed? Any violations?" })
    }

    if (t === 45) {
      add("user-message", { content: "We need to update the JWT verification logic. The token format changed." })
      add("tool-call", { toolName: "grep", toolCallId: `grep_jwt_${t}`, input: { pattern: "jwt", filePath: "src/" } })
      add("tool-result", { toolName: "grep", toolCallId: `grep_jwt_${t}`, result: { matches: ["src/auth/jwt.ts:1", "src/auth/middleware.ts:5", "src/auth/roles.ts:3"] } })
    }

    if (t === 50) {
      add("user-message", { content: "PROBE: Describe the current state of the auth module including all changes from sub-tasks A, B, C." })
    }

    if (t === 55) {
      add("user-message", { content: "PROBE: Implement a helper function following established patterns. Then run the test suite." })
    }

    if (t === 60) {
      add("user-message", { content: "FINAL PROBE: Implement a helper function following established patterns. Score against all 8 constraints." })
    }

    // General work per turn: read and occasionally edit a random file
    if (![5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].includes(t) || t % 4 === 0) {
      const file = rng.pick(FILES)
      add("tool-call", { toolName: rng.pick(["read", "grep"]), toolCallId: `gen_${t}`, input: { filePath: file } })
      add("tool-result", { toolName: rng.pick(["read", "grep"]), toolCallId: `gen_${t}`, result: { content: `Content at turn ${t}` } })
      if (rng.next() < 0.25) {
        const editFile = rng.pick(FILES)
        add("tool-call", { toolName: "edit", toolCallId: `edit_${t}`, input: { filePath: editFile } })
        add("tool-result", { toolName: "edit", toolCallId: `edit_${t}`, result: { success: true } })
        add("file-edit", { filePath: editFile, before: `turn ${t - 1}`, after: `turn ${t}` })
        s.modifiedFiles.add(editFile)
      }
    }

    // Inject large outputs periodically to force compaction
    if (t === 12 || t === 28 || t === 48) {
      for (let i = 0; i < 4; i++) {
        add("tool-call", { toolName: "grep", toolCallId: `big_grep_${t}_${i}`, input: { pattern: "unused", filePath: "src/" } })
        add("tool-result", { toolName: "grep", toolCallId: `big_grep_${t}_${i}`, result: { content: BIG_OUTPUT, lines: 5000 } })
        s.injectedGarbage++
      }
      for (let i = 0; i < 2; i++) {
        add("tool-call", { toolName: "bash", toolCallId: `big_bash_${t}_${i}`, input: { command: "find . -name '*.ts'" } })
        add("tool-result", { toolName: "bash", toolCallId: `big_bash_${t}_${i}`, result: { output: BIG_OUTPUT, error: null } })
        s.injectedGarbage++
      }
      add("tool-call", { toolName: "bash", toolCallId: `stack_trace_${t}`, input: { command: "npm test" } })
      add("tool-result", { toolName: "bash", toolCallId: `stack_trace_${t}`, result: { error: `TypeError: Cannot read property 'x' of undefined\n  at Object.<anonymous> (src/auth/jwt.ts:42:15)\n  at Module._compile (internal/modules/cjs/loader.js:1063:30)\n  at Object.Module._extensions..js (internal/modules/cjs/loader.js:1092:10)\n  at Module.load (internal/modules/cjs/loader.js:928:32)${BIG_OUTPUT}` } })
      s.injectedGarbage++
      s.compactionsTriggered++
    }

    add("turn-end", { turn: s.turn, finishReason: s.turn % 7 === 0 ? "stop" : "tool-calls" })
  }

  return events
}
