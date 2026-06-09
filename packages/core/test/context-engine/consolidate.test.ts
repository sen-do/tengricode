import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  ContextEvent,
  LocalMemoryStore,
  consolidateSession,
  injectManagedSection,
} from "@opencode-ai/core/context-engine"

function evt(id: string, session: string, type: string, data: Record<string, unknown>, ts = 1000): ContextEvent {
  return ContextEvent.make({ id, session_id: session, type, timestamp: ts, data })
}

function seedEvents(store: LocalMemoryStore, session: string) {
  Effect.runSync(
    Effect.forEach(
      [
        evt("1", session, "file-edit", { filePath: "src/main.ts", before: "old", after: "new" }),
        evt("2", session, "file-edit", { filePath: "src/main.ts", before: "new", after: "newer" }),
        evt("3", session, "file-edit", { filePath: "src/utils.ts", before: "old", after: "refactored" }),
        evt("4", session, "file-edit", { filePath: "src/main.ts", before: "newer", after: "final" }),
        evt("5", session, "decision", { content: "Use recursion instead of iteration for parser", status: "completed" }),
        evt("6", session, "decision", { content: "Use recursion instead of iteration for parser", status: "completed" }),
        evt("7", session, "decision", { content: "Add caching layer for database queries", status: "completed" }),
        evt("8", session, "tool-result", {
          toolName: "bash", toolCallId: "c8",
          result: { error: "TypeError: undefined is not a function in src/parser.ts:42" },
        }),
        evt("9", session, "tool-result", {
          toolName: "bash", toolCallId: "c9",
          result: { error: "TypeError: undefined is not a function in src/parser.ts:42" },
        }),
        evt("10", session, "tool-result", {
          toolName: "bash", toolCallId: "c10",
          result: { error: "ENOENT: no such file in src/config.json" },
        }),
      ],
      (e) => store.appendEvent(session, e),
      { discard: true },
    ),
  )
}

describe("consolidateSession", () => {
  test("extracts conventions from repeated decisions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-con-"))
    const store = new LocalMemoryStore({ dataDir: dir })
    const session = "ses_conv_1"
    seedEvents(store, session)
    const result = Effect.runSync(consolidateSession(session, store))
    expect(result).toContain("OPENGINE:START")
    expect(result).toContain("Use recursion instead of iteration for parser")
    expect(result).toContain("OPENGINE:END")
  })

  test("extracts gotchas from repeated errors", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-con-"))
    const store = new LocalMemoryStore({ dataDir: dir })
    const session = "ses_gotcha"
    seedEvents(store, session)
    const result = Effect.runSync(consolidateSession(session, store))
    expect(result).toContain("TypeError: undefined is not a function")
  })

  test("identifies key files by edit frequency", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-con-"))
    const store = new LocalMemoryStore({ dataDir: dir })
    const session = "ses_files"
    seedEvents(store, session)
    const result = Effect.runSync(consolidateSession(session, store))
    expect(result).toContain("src/main.ts")
    expect(result).toContain("modified 3 times")
  })

  test("does not include single-occurrence decisions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-con-"))
    const store = new LocalMemoryStore({ dataDir: dir })
    const session = "ses_single"
    seedEvents(store, session)
    const result = Effect.runSync(consolidateSession(session, store))
    expect(result).not.toContain("Add caching layer")
  })

  test("does not include single-occurrence errors in gotchas", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-con-"))
    const store = new LocalMemoryStore({ dataDir: dir })
    const session = "ses_noenoent"
    seedEvents(store, session)
    const result = Effect.runSync(consolidateSession(session, store))
    expect(result).not.toContain("ENOENT")
  })

  test("empty session produces minimal output", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-con-"))
    const store = new LocalMemoryStore({ dataDir: dir })
    const session = "ses_empty"
    const result = Effect.runSync(consolidateSession(session, store))
    expect(result).toContain("OPENGINE:START")
    expect(result).toContain("OPENGINE:END")
    expect(result).not.toContain("### Conventions")
  })
})

describe("injectManagedSection", () => {
  test("appends when no existing managed section", () => {
    const existing = "## Build\n\n- Run `npm test`\n"
    const managed = "<!-- OPENGINE:START -->\n## Managed\n<!-- OPENGINE:END -->\n"
    const result = injectManagedSection(existing, managed)
    expect(result).toContain("## Build")
    expect(result).toContain("## Managed")
  })

  test("replaces existing managed section", () => {
    const existing = "## Build\n\n<!-- OPENGINE:START -->\nold content\n<!-- OPENGINE:END -->\n\n## Deploy\n"
    const managed = "<!-- OPENGINE:START -->\nnew content\n<!-- OPENGINE:END -->\n"
    const result = injectManagedSection(existing, managed)
    expect(result).toContain("## Build")
    expect(result).toContain("new content")
    expect(result).toContain("## Deploy")
    expect(result).not.toContain("old content")
  })

  test("handles managed section at end of file", () => {
    const existing = "## Build\n\n<!-- OPENGINE:START -->\nold\n<!-- OPENGINE:END -->"
    const managed = "<!-- OPENGINE:START -->\nnew\n<!-- OPENGINE:END -->\n"
    const result = injectManagedSection(existing, managed)
    expect(result).toContain("new")
    expect(result).not.toContain("old")
  })
})
