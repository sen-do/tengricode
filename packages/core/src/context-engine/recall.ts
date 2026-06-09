import { Effect } from "effect"
import { ContextRecord, ContextRecordFilter, ContextEvent, type MemoryStore } from "./store"

export function eventToRecords(event: ContextEvent): ContextRecord[] {
  const data = event.data as Record<string, unknown>
  const base = {
    id: `rec_${event.id}`,
    session_id: event.session_id,
    timestamp: event.timestamp,
    tags: [] as string[],
  }

  if (event.type === "tool-call") {
    const toolName = data.toolName as string
    const input = data.input
    const filePath = input && typeof input === "object" ? (input as Record<string, unknown>).filePath as string | undefined : undefined
    return [
      ContextRecord.make({
        ...base,
        type: "tool-call",
        content: `${toolName}${filePath ? ` on ${filePath}` : ""}`,
        metadata: data,
        tags: ["tool", toolName, ...(filePath ? [filePath] : [])],
      }),
    ]
  }

  if (event.type === "tool-result") {
    const toolName = data.toolName as string
    return [
      ContextRecord.make({
        ...base,
        type: "tool-result",
        content: `${toolName} result`,
        metadata: data,
        tags: ["tool", toolName, "result"],
      }),
    ]
  }

  if (event.type === "file-edit") {
    const filePath = data.filePath as string
    return [
      ContextRecord.make({
        ...base,
        type: "file-edit",
        content: `Modified ${filePath}`,
        metadata: data,
        tags: ["edit", filePath],
      }),
    ]
  }

  if (event.type === "decision") {
    return [
      ContextRecord.make({
        ...base,
        type: "decision",
        content: data.content as string,
        metadata: { status: data.status },
        tags: ["decision", data.status as string],
      }),
    ]
  }

  return []
}

export function storeDeadEvents(
  dead: readonly ContextEvent[],
  store: MemoryStore,
): Effect.Effect<void> {
  return Effect.forEach(dead, (event) =>
    Effect.forEach(eventToRecords(event), (record) => store.putRecord(record)),
    { discard: true },
  )
}

export function retrieve(
  query: string,
  store: MemoryStore,
  filter?: ContextRecordFilter,
): Effect.Effect<readonly ContextRecord[]> {
  return store.listRecords(
    filter ?? ContextRecordFilter.make({}),
  ).pipe(
    Effect.map((records) =>
      records.filter(
        (r) =>
          r.content.toLowerCase().includes(query.toLowerCase()) ||
          r.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
      ),
    ),
  )
}

export function retrieveSemantic(
  query: string,
  k: number,
  store: MemoryStore,
): Effect.Effect<readonly ContextRecord[]> {
  return store.querySemantic(query, k).pipe(
    Effect.catchTag("SemanticNotSupported", () => Effect.succeed([] as readonly ContextRecord[])),
  )
}
