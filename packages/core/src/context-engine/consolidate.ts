import { Effect } from "effect"
import { ContextEvent, ContextRecord, type MemoryStore } from "./store"
import { ARCEvictionPolicy } from "./eviction"

function dataOf(event: ContextEvent): Record<string, unknown> {
  return event.data as Record<string, unknown>
}

function extractConventions(events: readonly ContextEvent[]): { conventions: string[]; gotchas: string[]; keyFiles: Array<{ path: string; reason: string }> } {
  const fileEdits = new Map<string, number>()
  const decisionThemes = new Map<string, { count: number; display: string }>()
  const errorPatterns = new Map<string, { count: number; display: string }>()
  const conventions: string[] = []
  const gotchas: string[] = []

  for (const evt of events) {
    if (evt.type === "file-edit") {
      const path = dataOf(evt).filePath as string
      fileEdits.set(path, (fileEdits.get(path) ?? 0) + 1)
    }
    if (evt.type === "decision") {
      const content = dataOf(evt).content as string
      const lower = content.toLowerCase()
      const existing = decisionThemes.get(lower)
      decisionThemes.set(lower, { count: (existing?.count ?? 0) + 1, display: content.slice(0, 1).toUpperCase() + content.slice(1) })
    }
    if (evt.type === "tool-result") {
      const result = dataOf(evt).result
      if (result && typeof result === "object" && (result as Record<string, unknown>).error) {
        const err = String((result as Record<string, unknown>).error)
        const existing = errorPatterns.get(err)
        errorPatterns.set(err, { count: (existing?.count ?? 0) + 1, display: err })
      }
    }
  }

  for (const [, { count, display }] of decisionThemes) {
    if (count >= 2) conventions.push(display)
  }

  for (const [, { count, display }] of errorPatterns) {
    if (count >= 2) gotchas.push(display)
  }

  const keyFiles = [...fileEdits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, reason: `modified ${count} time${count > 1 ? "s" : ""}` }))

  return { conventions, gotchas, keyFiles }
}

function buildManagedSection(input: {
  conventions: string[]
  gotchas: string[]
  keyFiles: Array<{ path: string; reason: string }>
  sessionId: string
}): string {
  const lines: string[] = []
  lines.push("<!-- OPENGINE:START -->")
  lines.push("## Context Engine Consolidation")
  lines.push(`Last consolidated: ${new Date().toISOString()}`)
  lines.push(`Session: ${input.sessionId}`)
  lines.push("")

  if (input.conventions.length > 0) {
    lines.push("### Conventions")
    for (const c of input.conventions) lines.push(`- ${c}`)
    lines.push("")
  }
  if (input.gotchas.length > 0) {
    lines.push("### Gotchas")
    for (const g of input.gotchas) lines.push(`- ${g}`)
    lines.push("")
  }
  if (input.keyFiles.length > 0) {
    lines.push("### Key Files")
    for (const f of input.keyFiles) lines.push(`- ${f.path}: ${f.reason}`)
    lines.push("")
  }

  lines.push("<!-- OPENGINE:END -->")
  return lines.join("\n")
}

export function consolidateSession(
  sessionId: string,
  store: MemoryStore,
  arc?: ARCEvictionPolicy,
): Effect.Effect<string> {
  return store.readEvents(sessionId).pipe(
    Effect.map((events) => {
      const weighted = applyArcWeights(events, arc)
      return extractConventions(weighted)
    }),
    Effect.map(({ conventions, gotchas, keyFiles }) =>
      buildManagedSection({ conventions, gotchas, keyFiles, sessionId }),
    ),
  )
}

function applyArcWeights(events: readonly ContextEvent[], arc?: ARCEvictionPolicy): ContextEvent[] {
  if (!arc) return [...events]
  const activeSet = new Set(arc.activeIds())
  return events
    .filter((e) => activeSet.has(e.id))
    .concat(events.filter((e) => !activeSet.has(e.id)))
}

export function writeConsolidationRecord(
  sessionId: string,
  store: MemoryStore,
  content: string,
): Effect.Effect<void> {
  return store.putRecord(
    ContextRecord.make({
      id: `consolidated_${sessionId}_${Date.now()}`,
      session_id: sessionId,
      type: "consolidation",
      content,
      metadata: { generated_at: new Date().toISOString() },
      tags: ["consolidation", "managed"],
      timestamp: Date.now(),
    }),
  )
}

const MANAGED_START = "<!-- OPENGINE:START -->"
const MANAGED_END = "<!-- OPENGINE:END -->"

export function injectManagedSection(existingContent: string, managedSection: string): string {
  const startIdx = existingContent.indexOf(MANAGED_START)
  const endIdx = existingContent.indexOf(MANAGED_END)

  if (startIdx === -1 || endIdx === -1) {
    const trimmed = existingContent.trimEnd()
    return trimmed + "\n\n" + managedSection + "\n"
  }

  const before = existingContent.slice(0, startIdx)
  const after = existingContent.slice(endIdx + MANAGED_END.length)
  return before + managedSection + after
}
