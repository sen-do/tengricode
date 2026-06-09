import { describe, test, expect } from "bun:test"
import { ContextEvent, analyzeLiveness, rebuildProjection } from "@opencode-ai/core/context-engine"

function evt(
  id: string,
  session: string,
  type: string,
  data: Record<string, unknown>,
  timestamp = 1000,
): ContextEvent {
  return ContextEvent.make({ id, session_id: session, type, timestamp, data })
}

const session = "ses_liveness"

describe("analyzeLiveness", () => {
  test("always keeps user-message and turn events live", () => {
    const events = [
      evt("1", session, "turn-start", { turn: 1 }),
      evt("2", session, "user-message", { content: "Fix bug" }),
      evt("3", session, "turn-end", { turn: 1, finishReason: "stop" }),
    ]
    const { live, dead } = analyzeLiveness(events)
    expect(live.length).toBe(3)
    expect(dead.length).toBe(0)
    expect(live.map((e) => e.id)).toEqual(["1", "2", "3"])
  })

  test("keeps decisions live", () => {
    const events = [
      evt("1", session, "decision", { content: "Use recursion", status: "in_progress" }),
    ]
    const { live, dead } = analyzeLiveness(events)
    expect(live.length).toBe(1)
    expect(dead.length).toBe(0)
  })

  test("marks read event as dead when followed by edit of same file", () => {
    const events = [
      evt("1", session, "tool-call", { toolName: "read", toolCallId: "call_1", input: { filePath: "src/a.ts" } }),
      evt("2", session, "tool-result", { toolName: "read", toolCallId: "call_1", result: { content: "old" } }),
      evt("3", session, "tool-call", { toolName: "edit", toolCallId: "call_2", input: { filePath: "src/a.ts" } }),
      evt("4", session, "tool-result", { toolName: "edit", toolCallId: "call_2", result: {} }),
      evt("5", session, "file-edit", { filePath: "src/a.ts", before: "old", after: "new" }),
    ]
    const { live, dead } = analyzeLiveness(events)
    const liveIds = live.map((e) => e.id)
    expect(liveIds).not.toContain("1")
    expect(liveIds).toContain("3")
    expect(liveIds).toContain("5")
    const deadIds = dead.map((e) => e.id)
    expect(deadIds).toContain("1")
  })

  test("keeps read live if file is never edited", () => {
    const events = [
      evt("1", session, "tool-call", { toolName: "read", toolCallId: "call_1", input: { filePath: "src/a.ts" } }),
      evt("2", session, "tool-result", { toolName: "read", toolCallId: "call_1", result: { content: "old" } }),
      evt("3", session, "user-message", { content: "ok" }),
    ]
    const { live } = analyzeLiveness(events)
    const liveIds = live.map((e) => e.id)
    expect(liveIds).toContain("1")
  })

  test("keeps all events live when no file superseding occurs", () => {
    const events = [
      evt("1", session, "turn-start", { turn: 1 }),
      evt("2", session, "tool-call", { toolName: "read", toolCallId: "c1", input: { filePath: "src/a.ts" } }),
      evt("3", session, "tool-result", { toolName: "read", toolCallId: "c1", result: {} }),
      evt("4", session, "tool-call", { toolName: "read", toolCallId: "c2", input: { filePath: "src/b.ts" } }),
      evt("5", session, "tool-result", { toolName: "read", toolCallId: "c2", result: {} }),
      evt("6", session, "turn-end", { turn: 1, finishReason: "stop" }),
    ]
    const { live } = analyzeLiveness(events)
    expect(live.length).toBe(6)
  })

  test("only the superseded read is dead, not other reads", () => {
    const events = [
      evt("1", session, "tool-call", { toolName: "read", toolCallId: "c1", input: { filePath: "src/a.ts" } }),
      evt("2", session, "tool-call", { toolName: "read", toolCallId: "c2", input: { filePath: "src/b.ts" } }),
      evt("3", session, "tool-call", { toolName: "edit", toolCallId: "c3", input: { filePath: "src/a.ts" } }),
      evt("4", session, "file-edit", { filePath: "src/a.ts", before: "old", after: "new" }),
    ]
    const { live, dead } = analyzeLiveness(events)
    const liveIds = live.map((e) => e.id)
    expect(liveIds).toContain("2")
    expect(liveIds).toContain("3")
    const deadIds = dead.map((e) => e.id)
    expect(deadIds).toContain("1")
  })
})

describe("rebuildProjection with liveness", () => {
  test("identity without liveness option", () => {
    const events = [
      evt("1", session, "tool-call", { toolName: "read", toolCallId: "c1", input: { filePath: "src/a.ts" } }),
      evt("2", session, "tool-call", { toolName: "edit", toolCallId: "c2", input: { filePath: "src/a.ts" } }),
      evt("3", session, "file-edit", { filePath: "src/a.ts" }),
    ]
    const result = rebuildProjection(events)
    expect(result).toEqual(events)
    expect(result.length).toBe(3)
  })

  test("filters dead events when liveness enabled", () => {
    const events = [
      evt("1", session, "user-message", { content: "Fix bug" }),
      evt("2", session, "tool-call", { toolName: "read", toolCallId: "c1", input: { filePath: "src/a.ts" } }),
      evt("3", session, "tool-call", { toolName: "edit", toolCallId: "c2", input: { filePath: "src/a.ts" } }),
      evt("4", session, "file-edit", { filePath: "src/a.ts", before: "old", after: "new" }),
      evt("5", session, "turn-end", { turn: 1, finishReason: "stop" }),
    ]
    const result = rebuildProjection(events, { liveness: true })
    const ids = result.map((e) => e.id)
    expect(ids).toContain("1")
    expect(ids).not.toContain("2")
    expect(ids).toContain("3")
    expect(ids).toContain("4")
    expect(ids).toContain("5")
  })

  test("empty events returns empty with liveness", () => {
    const result = rebuildProjection([], { liveness: true })
    expect(result).toEqual([])
  })
})
