import type { ContextEvent } from "./store"
import { ContextEvent as Event } from "./store"

function dataOf(event: ContextEvent): Record<string, unknown> {
  return event.data as Record<string, unknown>
}

const ALWAYS_LIVE = new Set(["user-message", "turn-start", "turn-end", "decision"])

export function analyzeLiveness(events: readonly ContextEvent[]): { readonly live: ContextEvent[]; readonly dead: ContextEvent[] } {
  const toolCallIds = new Set<string>()
  const lastReadByFile = new Map<string, string>()

  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]
    const data = dataOf(evt)

    if (evt.type === "tool-call") {
      toolCallIds.add(data.toolCallId as string)
      if (data.toolName === "read") {
        const path = data.input && typeof data.input === "object" ? (data.input as Record<string, unknown>).filePath as string | undefined : undefined
        if (path && !lastReadByFile.has(path)) lastReadByFile.set(path, evt.id)
      }
    }
  }

  const deadIds = new Set<string>()

  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]
    const data = dataOf(evt)

    if (evt.type === "file-edit") {
      const path = data.filePath as string
      const supersededReadId = lastReadByFile.get(path)
      if (supersededReadId) {
        deadIds.add(supersededReadId)
        const supersededRead = events.find((x) => x.id === supersededReadId)
        if (supersededRead) {
          const supersededToolCallId = dataOf(supersededRead).toolCallId as string
          for (const e of events) {
            if (e.type === "tool-result" && dataOf(e).toolCallId === supersededToolCallId)
              deadIds.add(e.id)
          }
        }
      }
    }
  }

  const live: ContextEvent[] = []
  const dead: ContextEvent[] = []

  for (const evt of events) {
    if (deadIds.has(evt.id) || (evt.type === "tool-result" && deadIds.has(dataOf(evt).toolCallId as string))) {
      dead.push(evt)
      continue
    }
    if (ALWAYS_LIVE.has(evt.type)) {
      live.push(evt)
      continue
    }
    if (evt.type === "tool-call") {
      const toolId = dataOf(evt).toolCallId as string
      if (deadIds.has(toolId)) {
        dead.push(evt)
        continue
      }
    }
    live.push(evt)
  }

  return { live, dead }
}

export function consolidateEvents(events: readonly ContextEvent[]): ContextEvent[] {
  if (events.length === 0) return []

  const result: ContextEvent[] = []
  let pendingReads: ContextEvent[] = []
  let pendingEdit: ContextEvent | undefined
  let pendingTest: ContextEvent | undefined

  for (const evt of events) {
    const data = dataOf(evt)

    if (evt.type === "tool-call" && data.toolName === "read") {
      pendingReads.push(evt)
      continue
    }

    if (evt.type === "tool-result" && pendingReads.length > 0) {
      continue
    }

    if (evt.type === "tool-call" && (data.toolName === "edit" || data.toolName === "write" || data.toolName === "apply_patch")) {
      pendingEdit = evt
      continue
    }

    if (evt.type === "tool-result" && pendingEdit !== undefined) {
      continue
    }

    if (evt.type === "tool-call" && data.toolName === "bash") {
      const input = data.input as Record<string, unknown> | undefined
      if (input && typeof input.command === "string" && input.command.includes("test")) {
        pendingTest = evt
        continue
      }
    }

    if (evt.type === "tool-result" && pendingTest !== undefined) {
      continue
    }

    if (pendingReads.length > 0 || pendingEdit !== undefined) {
      const filePaths = pendingReads
        .map((r) => {
          const d = dataOf(r)
          return d.input && typeof d.input === "object" ? (d.input as Record<string, unknown>).filePath as string | undefined : undefined
        })
        .filter((p): p is string => p !== undefined)
      const summary = filePaths.length > 0
        ? `Read and modified ${filePaths.join(", ")}${pendingTest !== undefined ? ", tests passing" : ""}`
        : `Completed file operations${pendingTest !== undefined ? ", tests passing" : ""}`
      const lastEvent = pendingTest ?? pendingEdit ?? pendingReads[pendingReads.length - 1]
      result.push(
        Event.make({
          id: `ctx_consolidated_${evt.id}`,
          session_id: evt.session_id,
          type: "file-edit",
          timestamp: evt.timestamp,
          data: { filePaths, summary },
        }),
      )
      pendingReads = []
      pendingEdit = undefined
      pendingTest = undefined
    }

    result.push(evt)
  }

  if (pendingReads.length > 0 || pendingEdit !== undefined) {
    const filePaths = pendingReads
      .map((r) => {
        const d = dataOf(r)
        return d.input && typeof d.input === "object" ? (d.input as Record<string, unknown>).filePath as string | undefined : undefined
      })
      .filter((p): p is string => p !== undefined)
    const lastEvent = pendingEdit ?? pendingReads[pendingReads.length - 1]
    result.push(
      Event.make({
        id: `ctx_consolidated_${lastEvent.id}`,
        session_id: lastEvent.session_id,
        type: "file-edit",
        timestamp: lastEvent.timestamp,
        data: { filePaths, summary: `Read ${filePaths.join(", ")}` },
      }),
    )
  }

  return result
}
