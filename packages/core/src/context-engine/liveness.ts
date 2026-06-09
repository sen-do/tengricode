import { ContextEvent } from "./store"

function dataOf(event: ContextEvent): Record<string, unknown> {
  return event.data as Record<string, unknown>
}

const ALWAYS_LIVE = new Set(["user-message", "turn-start", "turn-end", "decision"])

export function analyzeLiveness(events: readonly ContextEvent[]): { readonly live: ContextEvent[]; readonly dead: ContextEvent[] } {
  const lastReadByFile = new Map<string, string>()

  // Walk backwards to find the last read of each file before any edit supersedes it
  for (const evt of Array.from(events).reverse()) {
    if (evt.type !== "tool-call") continue
    const data = dataOf(evt)
    if (data.toolName !== "read") continue
    const input = data.input
    const path = input && typeof input === "object" ? (input as Record<string, unknown>).filePath as string | undefined : undefined
    if (path && !lastReadByFile.has(path)) lastReadByFile.set(path, evt.id)
  }

  // Walk backwards again to find file-edit events and mark superseded reads as dead
  const deadIds = new Set<string>()
  for (const evt of Array.from(events).reverse()) {
    if (evt.type !== "file-edit") continue
    const path = dataOf(evt).filePath as string
    const supersededReadId = lastReadByFile.get(path)
    if (!supersededReadId) continue
    deadIds.add(supersededReadId)
    const supersededRead = events.find((x) => x.id === supersededReadId)
    if (!supersededRead) continue
    const supersededToolCallId = dataOf(supersededRead).toolCallId as string
    events
      .filter((e) => e.type === "tool-result" && dataOf(e).toolCallId === supersededToolCallId)
      .forEach((e) => deadIds.add(e.id))
  }

  // Partition events into live and dead
  return events.reduce(
    (acc, evt) => {
      if (deadIds.has(evt.id)) {
        acc.dead.push(evt)
        return acc
      }
      if (ALWAYS_LIVE.has(evt.type)) {
        acc.live.push(evt)
        return acc
      }
      if (evt.type === "tool-call" || evt.type === "tool-result") {
        if (deadIds.has(dataOf(evt).toolCallId as string)) {
          acc.dead.push(evt)
          return acc
        }
      }
      acc.live.push(evt)
      return acc
    },
    { live: [] as ContextEvent[], dead: [] as ContextEvent[] },
  )
}

export function consolidateEvents(events: readonly ContextEvent[]): ContextEvent[] {
  if (events.length === 0) return []

  const result: ContextEvent[] = []
  const pending = { reads: [] as ContextEvent[], edit: undefined as ContextEvent | undefined, test: undefined as ContextEvent | undefined }

  const readPath = (r: ContextEvent) => {
    const d = dataOf(r)
    const input = d.input as Record<string, unknown> | undefined
    return input && typeof input.filePath === "string" ? input.filePath : undefined
  }

  const isRead = (evt: ContextEvent) => evt.type === "tool-call" && dataOf(evt).toolName === "read"
  const isEdit = (evt: ContextEvent) => evt.type === "tool-call" && (dataOf(evt).toolName === "edit" || dataOf(evt).toolName === "write" || dataOf(evt).toolName === "apply_patch")
  const isTest = (evt: ContextEvent) => {
    if (evt.type !== "tool-call" || dataOf(evt).toolName !== "bash") return false
    const input = dataOf(evt).input as Record<string, unknown> | undefined
    return typeof input?.command === "string" && input.command.includes("test")
  }
  const isResult = (evt: ContextEvent) => evt.type === "tool-result"

  const flush = (evt: ContextEvent) => {
    const filePaths = pending.reads.map(readPath).filter((p): p is string => p !== undefined)
    const summary = filePaths.length > 0
      ? `Read and modified ${filePaths.join(", ")}${pending.test ? ", tests passing" : ""}`
      : `Completed file operations${pending.test ? ", tests passing" : ""}`
    const lastEvt = pending.test ?? pending.edit ?? pending.reads[pending.reads.length - 1]
    result.push(
      ContextEvent.make({
        id: `ctx_consolidated_${evt.id}`,
        session_id: evt.session_id,
        type: "file-edit",
        timestamp: evt.timestamp,
        data: { filePaths, summary },
      }),
    )
    pending.reads = []
    pending.edit = undefined
    pending.test = undefined
  }

  for (const evt of events) {
    if (isRead(evt)) { pending.reads.push(evt); continue }
    if (isResult(evt) && pending.reads.length > 0) continue
    if (isEdit(evt)) { pending.edit = evt; continue }
    if (isResult(evt) && pending.edit) continue
    if (isTest(evt)) { pending.test = evt; continue }
    if (isResult(evt) && pending.test) continue

    if (pending.reads.length > 0 || pending.edit) flush(evt)
    result.push(evt)
  }

  if (pending.reads.length > 0 || pending.edit) {
    const filePaths = pending.reads.map(readPath).filter((p): p is string => p !== undefined)
    const lastEvt = pending.edit ?? pending.reads[pending.reads.length - 1]
    result.push(
      ContextEvent.make({
        id: `ctx_consolidated_${lastEvt.id}`,
        session_id: lastEvt.session_id,
        type: "file-edit",
        timestamp: lastEvt.timestamp,
        data: { filePaths, summary: `Read ${filePaths.join(", ")}` },
      }),
    )
  }

  return result
}
