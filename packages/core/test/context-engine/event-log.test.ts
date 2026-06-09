import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  ContextEvent,
  EventLog,
  LocalMemoryStore,
  rebuildProjection,
} from "@opencode-ai/core/context-engine"

const dataDir = mkdtempSync(path.join(tmpdir(), "opencode-ctx-el-"))
const store = new LocalMemoryStore({ dataDir })
const log = new EventLog(store)
const sessionId = "ses_eventlog_test"

describe("EventLog", () => {
  test("logUserMessage and readLog round-trip", () => {
    Effect.runSync(log.logUserMessage(sessionId, "Fix the bug in parser.ts"))
    const events = Effect.runSync(log.readLog(sessionId))
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("user-message")
    expect(events[0].data).toEqual({ content: "Fix the bug in parser.ts" })
  })

  test("logToolCall and logToolResult round-trip", () => {
    Effect.runSync(log.logToolCall(sessionId, "read", "call_1", { filePath: "/src/main.ts" }))
    Effect.runSync(log.logToolResult(sessionId, "read", "call_1", { content: "export const x = 1" }))
    const events = Effect.runSync(log.readLog(sessionId))
    const toolCalls = events.filter((e) => e.type === "tool-call")
    const toolResults = events.filter((e) => e.type === "tool-result")
    expect(toolCalls.length).toBeGreaterThanOrEqual(1)
    expect(toolResults.length).toBeGreaterThanOrEqual(1)
    const tc = toolCalls.find((e) => (e.data as Record<string, unknown>).toolCallId === "call_1")
    expect(tc).toBeDefined()
    expect((tc!.data as Record<string, unknown>).toolName).toBe("read")
  })

  test("logFileEdit captures path and content", () => {
    Effect.runSync(log.logFileEdit(sessionId, "src/parser.ts", "old code", "new code"))
    const events = Effect.runSync(log.readLog(sessionId))
    const edit = events.find((e) => e.type === "file-edit")
    expect(edit).toBeDefined()
    expect((edit!.data as Record<string, unknown>).filePath).toBe("src/parser.ts")
    expect((edit!.data as Record<string, unknown>).before).toBe("old code")
    expect((edit!.data as Record<string, unknown>).after).toBe("new code")
  })

  test("logDecision captures content and status", () => {
    Effect.runSync(log.logDecision(sessionId, "Refactor parser to use recursion", "completed"))
    const events = Effect.runSync(log.readLog(sessionId))
    const decision = events.find((e) => e.type === "decision")
    expect(decision).toBeDefined()
    expect((decision!.data as Record<string, unknown>).content).toBe("Refactor parser to use recursion")
    expect((decision!.data as Record<string, unknown>).status).toBe("completed")
  })

  test("logTurnStart and logTurnEnd mark boundaries", () => {
    Effect.runSync(log.logTurnStart(sessionId, 1))
    Effect.runSync(log.logTurnEnd(sessionId, 1, "stop"))
    const events = Effect.runSync(log.readLog(sessionId))
    const starts = events.filter((e) => e.type === "turn-start")
    const ends = events.filter((e) => e.type === "turn-end")
    expect(starts.length).toBeGreaterThanOrEqual(1)
    expect(ends.length).toBeGreaterThanOrEqual(1)
    expect((starts[starts.length - 1].data as Record<string, unknown>).turn).toBe(1)
    expect((ends[ends.length - 1].data as Record<string, unknown>).finishReason).toBe("stop")
  })

  test("events are immutable — re-reading returns same data", () => {
    const first = Effect.runSync(log.readLog(sessionId))
    const second = Effect.runSync(log.readLog(sessionId))
    expect(first.length).toBe(second.length)
    expect(first[first.length - 1].id).toBe(second[second.length - 1].id)
  })

  test("readLog returns empty for unknown session", () => {
    const events = Effect.runSync(log.readLog("ses_nonexistent"))
    expect(events).toEqual([])
  })
})

describe("rebuildProjection", () => {
  test("returns the same events (identity projection)", () => {
    const events = Effect.runSync(log.readLog(sessionId))
    const projection = rebuildProjection(events)
    expect(projection).toEqual(events)
  })

  test("empty events produces empty projection", () => {
    expect(rebuildProjection([])).toEqual([])
  })

  test("preserves event order", () => {
    const session = "ses_order_test"
    Effect.runSync(log.logTurnStart(session, 1))
    Effect.runSync(log.logToolCall(session, "read", "c1", {}))
    Effect.runSync(log.logToolResult(session, "read", "c1", {}))
    Effect.runSync(log.logTurnEnd(session, 1, "tool-calls"))
    const events = Effect.runSync(log.readLog(session))
    const projection = rebuildProjection(events)
    expect(projection[0].type).toBe("turn-start")
    expect(projection[1].type).toBe("tool-call")
    expect(projection[2].type).toBe("tool-result")
    expect(projection[3].type).toBe("turn-end")
  })
})
