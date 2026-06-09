import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  ContextEvent,
  ContextRecordFilter,
  LocalMemoryStore,
  eventToRecords,
  storeDeadEvents,
  retrieve,
  retrieveSemantic,
} from "@opencode-ai/core/context-engine"

const dataDir = mkdtempSync(path.join(tmpdir(), "opencode-ctx-rec-"))
const store = new LocalMemoryStore({ dataDir })
const session = "ses_recall"

function evt(id: string, type: string, data: Record<string, unknown>): ContextEvent {
  return ContextEvent.make({ id, session_id: session, type, timestamp: 1000 + parseInt(id.slice(-1)), data })
}

describe("eventToRecords", () => {
  test("converts tool-call to record with tags", () => {
    const e = evt("1", "tool-call", { toolName: "read", toolCallId: "c1", input: { filePath: "src/a.ts" } })
    const records = eventToRecords(e)
    expect(records.length).toBe(1)
    expect(records[0].type).toBe("tool-call")
    expect(records[0].tags).toContain("tool")
    expect(records[0].tags).toContain("read")
    expect(records[0].tags).toContain("src/a.ts")
  })

  test("converts file-edit to record", () => {
    const e = evt("2", "file-edit", { filePath: "src/main.ts", before: "old", after: "new" })
    const records = eventToRecords(e)
    expect(records.length).toBe(1)
    expect(records[0].type).toBe("file-edit")
    expect(records[0].content).toContain("src/main.ts")
    expect(records[0].tags).toContain("edit")
  })

  test("converts decision to record with status tag", () => {
    const e = evt("3", "decision", { content: "Use recursion instead of iteration", status: "completed" })
    const records = eventToRecords(e)
    expect(records.length).toBe(1)
    expect(records[0].type).toBe("decision")
    expect(records[0].content).toBe("Use recursion instead of iteration")
    expect(records[0].tags).toContain("decision")
    expect(records[0].tags).toContain("completed")
  })

  test("returns empty for unknown event type", () => {
    const e = evt("4", "turn-start", { turn: 1 })
    expect(eventToRecords(e)).toEqual([])
  })
})

describe("storeDeadEvents and retrieve", () => {
  test("round-trip: store dead events and retrieve by content", () => {
    const dead = [
      evt("5", "tool-call", { toolName: "edit", toolCallId: "c5", input: { filePath: "src/parser.ts" } }),
      evt("6", "tool-call", { toolName: "read", toolCallId: "c6", input: { filePath: "src/types.ts" } }),
      evt("7", "decision", { content: "Refactor parser to use algebraic types", status: "completed" }),
    ]
    Effect.runSync(storeDeadEvents(dead, store))

    const results = Effect.runSync(retrieve("parser", store))
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  test("retrieve filters by session_id", () => {
    const results = Effect.runSync(
      retrieve("parser", store, ContextRecordFilter.make({ session_id: session })),
    )
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  test("retrieve returns empty for unrelated query", () => {
    const results = Effect.runSync(retrieve("nonexistent_query_xyz", store))
    expect(results.filter((r) => r.session_id === session).length).toBe(0)
  })

  test("retrieve matches by tag", () => {
    const results = Effect.runSync(retrieve("edit", store))
    const hasEdit = results.some((r) => r.tags.includes("edit"))
    expect(hasEdit).toBe(true)
  })

  test("retrieve is case-insensitive", () => {
    const results = Effect.runSync(retrieve("PARSER", store))
    expect(results.length).toBeGreaterThanOrEqual(1)
    const content = results.map((r) => r.content).join(" ").toLowerCase()
    expect(content).toContain("parser")
  })
})

describe("retrieveSemantic", () => {
  test("degrades gracefully when semantic search is not supported", () => {
    const result = Effect.runSync(retrieveSemantic("test query", 3, store))
    expect(result).toEqual([])
  })
})
