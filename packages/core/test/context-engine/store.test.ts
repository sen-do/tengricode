import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  ContextEvent,
  ContextRecord,
  ContextRecordFilter,
  LocalMemoryStore,
} from "@opencode-ai/core/context-engine"

const dataDir = mkdtempSync(path.join(tmpdir(), "opencode-ctx-"))
const store = new LocalMemoryStore({ dataDir })

const event = ContextEvent.make({
  id: "evt_1",
  session_id: "ses_test",
  type: "tool-call",
  timestamp: 1000,
  data: { name: "read", input: { path: "/foo" } },
})

const record = ContextRecord.make({
  id: "rec_1",
  session_id: "ses_test",
  type: "decision",
  content: "Use recursion instead of iteration",
  metadata: { reason: "cleaner with algebraic types" },
  tags: ["algorithm", "optimization"],
  timestamp: 2000,
})

const record2 = ContextRecord.make({
  id: "rec_2",
  session_id: "ses_test",
  type: "file-change",
  content: "Modified src/main.ts:15",
  metadata: { file: "src/main.ts", lines: 15 },
  tags: ["edit"],
  timestamp: 3000,
})

const record3 = ContextRecord.make({
  id: "rec_3",
  session_id: "ses_other",
  type: "decision",
  content: "Other session decision",
  metadata: {},
  tags: [],
  timestamp: 4000,
})

describe("LocalMemoryStore", () => {
  test("appendEvent and readEvents round-trip", () => {
    Effect.runSync(store.appendEvent("ses_test", event))
    const events = Effect.runSync(store.readEvents("ses_test"))
    expect(events.length).toBeGreaterThanOrEqual(1)
    const found = events.find((e) => e.id === "evt_1")
    expect(found).toBeDefined()
    expect(found!.type).toBe("tool-call")
    expect(found!.data).toEqual({ name: "read", input: { path: "/foo" } })
  })

  test("readEvents returns empty for unknown session", () => {
    const events = Effect.runSync(store.readEvents("ses_nonexistent"))
    expect(events).toEqual([])
  })

  test("putRecord and getRecord round-trip", () => {
    Effect.runSync(store.putRecord(record))
    const fetched = Effect.runSync(store.getRecord("rec_1"))
    expect(fetched).toBeDefined()
    expect(fetched!.id).toBe("rec_1")
    expect(fetched!.type).toBe("decision")
    expect(fetched!.content).toBe("Use recursion instead of iteration")
    expect(fetched!.tags).toContain("algorithm")
    expect(fetched!.tags).toContain("optimization")
  })

  test("getRecord returns undefined for unknown id", () => {
    const fetched = Effect.runSync(store.getRecord("nonexistent"))
    expect(fetched).toBeUndefined()
  })

  test("listRecords filters by session_id", () => {
    Effect.runSync(store.putRecord(record2))
    Effect.runSync(store.putRecord(record3))

    const filter = ContextRecordFilter.make({ session_id: "ses_test" })
    const results = Effect.runSync(store.listRecords(filter))
    expect(results.length).toBeGreaterThanOrEqual(2)
    for (const r of results) {
      expect(r.session_id).toBe("ses_test")
    }
  })

  test("listRecords filters by type", () => {
    const filter = ContextRecordFilter.make({ type: "decision" })
    const results = Effect.runSync(store.listRecords(filter))
    for (const r of results) {
      expect(r.type).toBe("decision")
    }
  })

  test("listRecords filters by tags", () => {
    const filter = ContextRecordFilter.make({ tags: ["algorithm"] })
    const results = Effect.runSync(store.listRecords(filter))
    for (const r of results) {
      expect(r.tags).toContain("algorithm")
    }
  })

  test("listRecords returns empty for no matches", () => {
    const filter = ContextRecordFilter.make({ type: "nonexistent-type" })
    const results = Effect.runSync(store.listRecords(filter))
    expect(results).toEqual([])
  })

  test("querySemantic returns not supported", () => {
    const result = Effect.runSyncExit(store.querySemantic("test query", 3))
    expect(result._tag).toBe("Failure")
  })

  test("putRecord overwrites existing record", () => {
    const updated = ContextRecord.make({
      id: "rec_1",
      session_id: "ses_test",
      type: "decision",
      content: "Updated content",
      metadata: { updated: true },
      tags: ["updated"],
      timestamp: 5000,
    })
    Effect.runSync(store.putRecord(updated))
    const fetched = Effect.runSync(store.getRecord("rec_1"))
    expect(fetched!.content).toBe("Updated content")
    expect(fetched!.tags).toEqual(["updated"])
  })
})
