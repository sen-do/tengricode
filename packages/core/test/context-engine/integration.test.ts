import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  ContextEvent,
  LocalMemoryStore,
  EventLog,
  analyzeLiveness,
  storeDeadEvents,
  retrieve,
  retrieveSemantic,
  ARCEvictionPolicy,
  consolidateSession,
  injectManagedSection,
} from "@opencode-ai/core/context-engine"

const dir = mkdtempSync(path.join(tmpdir(), "opencode-integration-"))
const store = new LocalMemoryStore({ dataDir: dir })
const log = new EventLog(store)
const session = "ses_integration_test"

// Simulate a realistic coding session
function runSession() {
  Effect.runSync(
    Effect.gen(function* () {
      // User asks to refactor the parser
      yield* log.logTurnStart(session, 1)
      yield* log.logUserMessage(session, "Refactor the parser to use recursion instead of iteration")
      yield* log.logToolCall(session, "read", "call_1", { filePath: "src/parser.ts" })
      yield* log.logToolResult(session, "read", "call_1", { content: "function parse() { for (const t of tokens) { ... } }" })
      yield* log.logDecision(session, "Decide to use recursive descent approach", "in_progress")
      yield* log.logToolCall(session, "edit", "call_2", { filePath: "src/parser.ts", oldText: "for (const t", newText: "return parseExpr()" })
      yield* log.logToolResult(session, "edit", "call_2", { result: "ok" })
      yield* log.logFileEdit(session, "src/parser.ts", "for loop", "recursive call")
      yield* log.logToolCall(session, "bash", "call_3", { command: "npm test -- parser" })
      yield* log.logToolResult(session, "bash", "call_3", { result: "error", error: "TypeError: parseExpr is not defined at parser.ts:15" })
      yield* log.logTurnEnd(session, 1, "tool-calls")

      // Turn 2: fix the error
      yield* log.logTurnStart(session, 2)
      yield* log.logToolCall(session, "read", "call_4", { filePath: "src/parser.ts" })
      yield* log.logToolResult(session, "read", "call_4", { content: "function parseExpr() { ... }" })
      yield* log.logToolCall(session, "edit", "call_5", { filePath: "src/parser.ts", oldText: "parseExpr", newText: "function parseExpr(tokens) { return parseAtom(tokens) }" })
      yield* log.logFileEdit(session, "src/parser.ts", "missing function", "defined function")
      yield* log.logToolCall(session, "bash", "call_6", { command: "npm test -- parser" })
      yield* log.logToolResult(session, "bash", "call_6", { result: "error", error: "TypeError: parseExpr is not defined at parser.ts:15" })
      yield* log.logTurnEnd(session, 2, "tool-calls")

      // Turn 3: it works now
      yield* log.logTurnStart(session, 3)
      yield* log.logToolCall(session, "read", "call_7", { filePath: "src/parser.ts" })
      yield* log.logToolResult(session, "read", "call_7", { content: "function parseExpr(tokens) { ... } function parseAtom(tokens) { ... }" })
      yield* log.logToolCall(session, "edit", "call_8", { filePath: "src/parser.ts", oldText: "parseAtom(tokens)", newText: "parseAtom(tokens[0] ? tokens : [])" })
      yield* log.logFileEdit(session, "src/parser.ts", "wrong arg", "corrected arg")
      yield* log.logToolCall(session, "bash", "call_9", { command: "npm test -- parser" })
      yield* log.logToolResult(session, "bash", "call_9", { result: "6 tests passing" })
      yield* log.logDecision(session, "Decide to use recursive descent approach", "completed")
      yield* log.logDecision(session, "Parser should use recursion for all other parts too", "completed")
      yield* log.logDecision(session, "Parser should use recursion for expression handling", "completed")
      yield* log.logTurnEnd(session, 3, "stop")
    }),
  )
}

describe("context engine integration", () => {
  runSession()
  const events = Effect.runSync(store.readEvents(session))
  const { live, dead } = analyzeLiveness(events)

  test("event log captures the full session", () => {
      expect(events.length).toBeGreaterThan(20)
      const types = events.map((e) => e.type)
      expect(types).toContain("user-message")
      expect(types).toContain("tool-call")
      expect(types).toContain("tool-result")
      expect(types).toContain("file-edit")
      expect(types).toContain("decision")
      expect(types).toContain("turn-start")
      expect(types).toContain("turn-end")
    })

    test("liveness filters out superseded reads", () => {
      const { live, dead } = analyzeLiveness(events)
      // The reads of parser.ts in turns 1-3 should be dead (superseded by edits)
      const deadReadIds = dead
        .filter((e) => e.type === "tool-call")
        .filter((e) => {
          const d = e.data as Record<string, unknown>
          return d.toolName === "read"
        })
      expect(deadReadIds.length).toBeGreaterThan(0)

      // All file-edits and user messages must be live
      const liveTypes = live.map((e) => e.type)
      expect(liveTypes).toContain("user-message")
      expect(liveTypes).toContain("file-edit")
    })

    test("recall stores and retrieves dead events", () => {
      const { dead } = analyzeLiveness(events)
      Effect.runSync(storeDeadEvents(dead, store))

      // Retrieve events about parser.ts
      const results = Effect.runSync(retrieve("parser", store))
      expect(results.length).toBeGreaterThanOrEqual(1)

      // Precision: file edit records are findable
      const parserResults = Effect.runSync(retrieve("src/parser.ts", store))
      expect(parserResults.length).toBeGreaterThanOrEqual(1)

      // Precision: unrelated query returns nothing
      const none = Effect.runSync(retrieve("this query should not match", store))
      expect(none.filter((r) => r.session_id === session).length).toBe(0)
    })

    test("consolidation distills conventions from repeated decisions", () => {
      const result = Effect.runSync(consolidateSession(session, store))
      expect(result).toContain("OPENGINE:START")
      expect(result).toContain("recursive")
      expect(result).toContain("src/parser.ts")
      expect(result).toContain("modified")
      // The same error happened twice → gotcha
      expect(result).toContain("TypeError")
    })

    test("managed section can be injected into existing AGENTS.md", () => {
      const existing = "# Project Rules\n\n- Use tabs not spaces\n- Run npm test before push\n"
      const result = Effect.runSync(consolidateSession(session, store))
      const output = injectManagedSection(existing, result)
      expect(output).toContain("# Project Rules")
      expect(output).toContain("OPENGINE:START")
      expect(output).toContain("OPENGINE:END")
    })

    test("event log is persisted on disk", () => {
      const eventPath = path.join(dir, "sessions", session, "events.jsonl")
      expect(existsSync(eventPath)).toBe(true)
      const raw = readFileSync(eventPath, "utf-8")
      const lines = raw.trim().split("\n")
      expect(lines.length).toBe(events.length)
    })

    test("ARC policy handles the session", () => {
      const arc = new ARCEvictionPolicy(15)
      for (const evt of events) arc.access(evt.id)
      arc.evictToCapacity()
      const active = arc.activeIds()
      expect(active.length).toBeLessThanOrEqual(events.length)

      // Ghost list tracks evicted items
      const ghost = arc.ghostList()
      expect(ghost.length).toBeGreaterThan(0)

      // Re-accessing a ghost item brings it back
      arc.access(ghost[0])
      expect(arc.activeIds()).toContain(ghost[0])
    })

    test("semantic recall degrades gracefully", () => {
      const result = Effect.runSync(retrieveSemantic("parser recursion", 3, store))
      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual([])
  })
})
