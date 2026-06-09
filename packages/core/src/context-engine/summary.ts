import { Schema } from "effect"

export class Decision extends Schema.Class<Decision>("ContextEngineDecision")({
  decision: Schema.String,
  rationale: Schema.String,
}) {}

export class FileEntry extends Schema.Class<FileEntry>("ContextEngineFileEntry")({
  path: Schema.String,
  reason: Schema.String,
}) {}

export class StructuredSummary extends Schema.Class<StructuredSummary>("ContextEngineStructuredSummary")({
  goal: Schema.mutable(Schema.Array(Schema.String)),
  constraints: Schema.mutable(Schema.Array(Schema.String)),
  done: Schema.mutable(Schema.Array(Schema.String)),
  inProgress: Schema.mutable(Schema.Array(Schema.String)),
  blocked: Schema.mutable(Schema.Array(Schema.String)),
  decisions: Schema.mutable(Schema.Array(Decision)),
  nextSteps: Schema.mutable(Schema.Array(Schema.String)),
  criticalContext: Schema.mutable(Schema.Array(Schema.String)),
  relevantFiles: Schema.mutable(Schema.Array(FileEntry)),
}) {}

export function emptySummary(): StructuredSummary {
  return StructuredSummary.make({
    goal: [],
    constraints: [],
    done: [],
    inProgress: [],
    blocked: [],
    decisions: [],
    nextSteps: [],
    criticalContext: [],
    relevantFiles: [],
  })
}

function dedupeStrings(items: readonly string[]): string[] {
  return [...new Set(items)]
}

function mergeDecisions(existing: readonly Decision[], incoming: readonly Decision[]): Decision[] {
  const seen = new Set(existing.map((d) => d.decision.toLowerCase()))
  const merged = [...existing]
  for (const d of incoming) {
    if (seen.has(d.decision.toLowerCase())) continue
    seen.add(d.decision.toLowerCase())
    merged.push(Decision.make({ decision: d.decision, rationale: d.rationale }))
  }
  return merged
}

function mergeFiles(existing: readonly FileEntry[], incoming: readonly FileEntry[]): FileEntry[] {
  const map = new Map<string, string>()
  for (const f of existing) map.set(f.path, f.reason)
  for (const f of incoming) map.set(f.path, f.reason)
  return [...map.entries()].map(([path, reason]) => FileEntry.make({ path, reason }))
}

export function mergeSummary(
  existing: StructuredSummary,
  incoming: StructuredSummary,
): StructuredSummary {
  return StructuredSummary.make({
    goal: incoming.goal.length > 0 ? dedupeStrings(incoming.goal) : dedupeStrings(existing.goal),
    constraints:
      incoming.constraints.length > 0
        ? dedupeStrings([...existing.constraints, ...incoming.constraints])
        : dedupeStrings(existing.constraints),
    done: dedupeStrings([...existing.done, ...incoming.done]),
    inProgress: incoming.inProgress.length > 0 ? dedupeStrings(incoming.inProgress) : dedupeStrings(existing.inProgress),
    blocked: incoming.blocked.length > 0 ? dedupeStrings(incoming.blocked) : dedupeStrings(existing.blocked),
    decisions: mergeDecisions(existing.decisions, incoming.decisions),
    nextSteps: incoming.nextSteps.length > 0 ? dedupeStrings(incoming.nextSteps) : dedupeStrings(existing.nextSteps),
    criticalContext: dedupeStrings([...existing.criticalContext, ...incoming.criticalContext]),
    relevantFiles: mergeFiles(existing.relevantFiles, incoming.relevantFiles),
  })
}

const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.

<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision]: [rationale] or "(none)"

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path]: [why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

export function buildStructuredPrompt(input: {
  readonly previousSummary?: string
  readonly context: readonly string[]
}): string {
  return [
    input.previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored summary from the conversation history.",
    SUMMARY_TEMPLATE,
    ...input.context,
  ].join("\n\n")
}

export function serializeSummary(summary: StructuredSummary): string {
  const lines: string[] = []
  lines.push("## Goal")
  for (const item of summary.goal) lines.push(`- ${item}`)
  if (summary.goal.length === 0) lines.push("- (none)")

  lines.push("")
  lines.push("## Constraints & Preferences")
  for (const item of summary.constraints) lines.push(`- ${item}`)
  if (summary.constraints.length === 0) lines.push("- (none)")

  lines.push("")
  lines.push("## Progress")
  lines.push("### Done")
  for (const item of summary.done) lines.push(`- ${item}`)
  if (summary.done.length === 0) lines.push("- (none)")
  lines.push("### In Progress")
  for (const item of summary.inProgress) lines.push(`- ${item}`)
  if (summary.inProgress.length === 0) lines.push("- (none)")
  lines.push("### Blocked")
  for (const item of summary.blocked) lines.push(`- ${item}`)
  if (summary.blocked.length === 0) lines.push("- (none)")

  lines.push("")
  lines.push("## Key Decisions")
  for (const d of summary.decisions) lines.push(`- ${d.decision}: ${d.rationale}`)
  if (summary.decisions.length === 0) lines.push("- (none)")

  lines.push("")
  lines.push("## Next Steps")
  for (const item of summary.nextSteps) lines.push(`- ${item}`)
  if (summary.nextSteps.length === 0) lines.push("- (none)")

  lines.push("")
  lines.push("## Critical Context")
  for (const item of summary.criticalContext) lines.push(`- ${item}`)
  if (summary.criticalContext.length === 0) lines.push("- (none)")

  lines.push("")
  lines.push("## Relevant Files")
  for (const f of summary.relevantFiles) lines.push(`- ${f.path}: ${f.reason}`)
  if (summary.relevantFiles.length === 0) lines.push("- (none)")

  return lines.join("\n")
}
