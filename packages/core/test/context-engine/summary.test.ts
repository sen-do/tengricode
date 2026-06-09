import { describe, test, expect } from "bun:test"
import {
  emptySummary,
  mergeSummary,
  serializeSummary,
  StructuredSummary,
  Decision,
  FileEntry,
  AnchorRegistry,
} from "@opencode-ai/core/context-engine"

describe("StructuredSummary", () => {
  test("emptySummary creates empty sections", () => {
    const summary = emptySummary()
    expect(summary.goal).toEqual([])
    expect(summary.constraints).toEqual([])
    expect(summary.done).toEqual([])
    expect(summary.inProgress).toEqual([])
    expect(summary.blocked).toEqual([])
    expect(summary.decisions).toEqual([])
    expect(summary.nextSteps).toEqual([])
    expect(summary.criticalContext).toEqual([])
    expect(summary.relevantFiles).toEqual([])
  })

  test("mergeSummary preserves existing goal when incoming is empty", () => {
    const existing = StructuredSummary.make({
      goal: ["Fix parser bug"],
      constraints: [],
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const incoming = emptySummary()
    const merged = mergeSummary(existing, incoming)
    expect(merged.goal).toEqual(["Fix parser bug"])
  })

  test("mergeSummary replaces goal when incoming has content", () => {
    const existing = StructuredSummary.make({
      goal: ["Fix parser bug"],
      constraints: [],
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const incoming = StructuredSummary.make({
      goal: ["Refactor parser"],
      constraints: [],
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const merged = mergeSummary(existing, incoming)
    expect(merged.goal).toEqual(["Refactor parser"])
  })

  test("mergeSummary appends done items", () => {
    const existing = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: ["Added tests"],
      inProgress: [],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const incoming = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: ["Fixed type error"],
      inProgress: [],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const merged = mergeSummary(existing, incoming)
    expect(merged.done).toContain("Added tests")
    expect(merged.done).toContain("Fixed type error")
  })

  test("mergeSummary replaces inProgress when incoming has content", () => {
    const existing = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: [],
      inProgress: ["Writing tests"],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const incoming = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: [],
      inProgress: ["Running CI"],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const merged = mergeSummary(existing, incoming)
    expect(merged.inProgress).toEqual(["Running CI"])
  })

  test("mergeSummary deduplicates decisions", () => {
    const existing = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [Decision.make({ decision: "Use Map", rationale: "faster lookups" })],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const incoming = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [
        Decision.make({ decision: "Use Map", rationale: "faster" }),
        Decision.make({ decision: "Add cache", rationale: "reduce latency" }),
      ],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [],
    })
    const merged = mergeSummary(existing, incoming)
    expect(merged.decisions.length).toBe(2)
  })

  test("mergeSummary updates relevantFiles, deduplicating by path", () => {
    const existing = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [FileEntry.make({ path: "src/a.ts", reason: "initial" })],
    })
    const incoming = StructuredSummary.make({
      goal: [],
      constraints: [],
      done: [],
      inProgress: [],
      blocked: [],
      decisions: [],
      nextSteps: [],
      criticalContext: [],
      relevantFiles: [
        FileEntry.make({ path: "src/a.ts", reason: "updated" }),
        FileEntry.make({ path: "src/b.ts", reason: "new file" }),
      ],
    })
    const merged = mergeSummary(existing, incoming)
    expect(merged.relevantFiles.length).toBe(2)
    const fileA = merged.relevantFiles.find((f) => f.path === "src/a.ts")
    expect(fileA!.reason).toBe("updated")
  })

  test("mergeSummary merges multiple sections simultaneously", () => {
    const existing = StructuredSummary.make({
      goal: ["Add dark mode"],
      constraints: ["Don't change layout"],
      done: ["Added CSS variables"],
      inProgress: ["Converting components"],
      blocked: [],
      decisions: [Decision.make({ decision: "Use CSS vars", rationale: "simple" })],
      nextSteps: ["Convert header"],
      criticalContext: ["Build requires Node 20+"],
      relevantFiles: [FileEntry.make({ path: "src/theme.css", reason: "main theme" })],
    })
    const incoming = StructuredSummary.make({
      goal: [],
      constraints: ["Respect system preference"],
      done: ["Converted button component"],
      inProgress: ["Converting modal"],
      blocked: ["Need design spec for sidebar"],
      decisions: [Decision.make({ decision: "Use prefers-color-scheme", rationale: "respects OS" })],
      nextSteps: ["Finish modal", "Start sidebar"],
      criticalContext: ["Overflow hidden breaks scroll"],
      relevantFiles: [FileEntry.make({ path: "src/modal.css", reason: "modal styles" })],
    })
    const merged = mergeSummary(existing, incoming)
    expect(merged.goal).toContain("Add dark mode")
    expect(merged.constraints).toContain("Don't change layout")
    expect(merged.constraints).toContain("Respect system preference")
    expect(merged.done).toContain("Added CSS variables")
    expect(merged.done).toContain("Converted button component")
    expect(merged.inProgress).toEqual(["Converting modal"])
    expect(merged.blocked).toEqual(["Need design spec for sidebar"])
    expect(merged.decisions.length).toBe(2)
    expect(merged.nextSteps).toEqual(["Finish modal", "Start sidebar"])
    expect(merged.criticalContext).toContain("Build requires Node 20+")
    expect(merged.criticalContext).toContain("Overflow hidden breaks scroll")
    expect(merged.relevantFiles.length).toBe(2)
  })

  test("serializeSummary produces all sections", () => {
    const summary = StructuredSummary.make({
      goal: ["Add dark mode"],
      constraints: ["Don't change layout"],
      done: ["Added CSS variables"],
      inProgress: ["Converting components"],
      blocked: [],
      decisions: [Decision.make({ decision: "Use CSS vars", rationale: "simple" })],
      nextSteps: ["Convert header"],
      criticalContext: [],
      relevantFiles: [FileEntry.make({ path: "src/theme.css", reason: "main theme" })],
    })
    const serialized = serializeSummary(summary)
    expect(serialized).toContain("## Goal")
    expect(serialized).toContain("Add dark mode")
    expect(serialized).toContain("## Constraints")
    expect(serialized).toContain("## Progress")
    expect(serialized).toContain("### Done")
    expect(serialized).toContain("### In Progress")
    expect(serialized).toContain("### Blocked")
    expect(serialized).toContain("## Key Decisions")
    expect(serialized).toContain("Use CSS vars: simple")
    expect(serialized).toContain("## Next Steps")
    expect(serialized).toContain("## Critical Context")
    expect(serialized).toContain("## Relevant Files")
    expect(serialized).toContain("src/theme.css: main theme")
  })

  test("serializeSummary shows (none) for empty sections", () => {
    const serialized = serializeSummary(emptySummary())
    expect(serialized).toContain("- (none)")
  })
})

describe("AnchorRegistry", () => {
  test("pin adds an active anchor", () => {
    const registry = new AnchorRegistry()
    registry.pin("anchor_1", "constraint", "Do not modify config files")
    const active = registry.active()
    expect(active.length).toBe(1)
    expect(active[0].content).toBe("Do not modify config files")
    expect(active[0].pinned).toBe(true)
  })

  test("unpin deactivates but preserves anchor", () => {
    const registry = new AnchorRegistry()
    registry.pin("anchor_1", "constraint", "Do not modify config files")
    registry.unpin("anchor_1")
    const active = registry.active()
    expect(active.length).toBe(0)
    const all = registry.all()
    expect(all.length).toBe(1)
    expect(all[0].pinned).toBe(false)
  })

  test("active returns only pinned anchors", () => {
    const registry = new AnchorRegistry()
    registry.pin("a", "constraint", "A")
    registry.pin("b", "task-intent", "B")
    registry.unpin("a")
    const active = registry.active()
    expect(active.length).toBe(1)
    expect(active[0].id).toBe("b")
  })

  test("get returns anchor by id", () => {
    const registry = new AnchorRegistry()
    registry.pin("anchor_1", "constraint", "Do not modify config files")
    const found = registry.get("anchor_1")
    expect(found).toBeDefined()
    expect(found!.content).toBe("Do not modify config files")
    expect(registry.get("nonexistent")).toBeUndefined()
  })

  test("re-pinning updates content", () => {
    const registry = new AnchorRegistry()
    registry.pin("anchor_1", "constraint", "Initial")
    registry.pin("anchor_1", "constraint", "Updated")
    const found = registry.get("anchor_1")
    expect(found!.content).toBe("Updated")
    expect(found!.pinned).toBe(true)
  })

  test("snapshot and restore round-trip", () => {
    const registry = new AnchorRegistry()
    registry.pin("a", "constraint", "A")
    registry.pin("b", "task-intent", "B")
    const snap = registry.snapshot()

    const registry2 = new AnchorRegistry()
    registry2.restore(snap)
    expect(registry2.active().length).toBe(2)
    expect(registry2.get("a")!.content).toBe("A")
  })

  test("clear removes all anchors", () => {
    const registry = new AnchorRegistry()
    registry.pin("a", "constraint", "A")
    registry.clear()
    expect(registry.all().length).toBe(0)
  })
})
