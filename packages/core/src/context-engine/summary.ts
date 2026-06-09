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
  const novel = incoming.filter((d) => !seen.has(d.decision.toLowerCase()))
  novel.forEach((d) => seen.add(d.decision.toLowerCase()))
  return [...existing, ...novel]
}

function mergeFiles(existing: readonly FileEntry[], incoming: readonly FileEntry[]): FileEntry[] {
  const map = new Map(existing.map((f) => [f.path, f.reason]))
  incoming.forEach((f) => map.set(f.path, f.reason))
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
  const section = (heading: string, items: readonly string[]) =>
    [heading, ...items.map((item) => `- ${item}`), ...(items.length === 0 ? ["- (none)"] : [])].join("\n")

  const subSection = (heading: string, items: readonly string[]) =>
    [heading, ...items.map((item) => `- ${item}`), ...(items.length === 0 ? ["- (none)"] : [])].join("\n")

  return [
    section("## Goal", summary.goal),
    section("## Constraints & Preferences", summary.constraints),
    "## Progress",
    subSection("### Done", summary.done),
    subSection("### In Progress", summary.inProgress),
    subSection("### Blocked", summary.blocked),
    section(
      "## Key Decisions",
      summary.decisions.length > 0
        ? summary.decisions.map((d) => `${d.decision}: ${d.rationale}`)
        : [],
    ),
    section("## Next Steps", summary.nextSteps),
    section("## Critical Context", summary.criticalContext),
    section(
      "## Relevant Files",
      summary.relevantFiles.length > 0
        ? summary.relevantFiles.map((f) => `${f.path}: ${f.reason}`)
        : [],
    ),
  ].join("\n\n")
}
