import { Effect } from "effect"
import { ContextEvent, type MemoryStore } from "./store"

let seq = 0

function nextId(prefix: string): string {
  return `${prefix}_${++seq}_${Date.now()}`
}

function makeEvent(sessionId: string, type: string, data: unknown): ContextEvent {
  return ContextEvent.make({
    id: nextId("ctx"),
    session_id: sessionId,
    type,
    timestamp: Date.now(),
    data,
  })
}

export class EventLog {
  constructor(readonly store: MemoryStore) {}

  logUserMessage(sessionId: string, content: string): Effect.Effect<void> {
    return this.store.appendEvent(sessionId, makeEvent(sessionId, "user-message", { content }))
  }

  logAssistantText(sessionId: string, content: string): Effect.Effect<void> {
    return this.store.appendEvent(sessionId, makeEvent(sessionId, "assistant-text", { content }))
  }

  logToolCall(sessionId: string, toolName: string, toolCallId: string, input: unknown): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      makeEvent(sessionId, "tool-call", { toolName, toolCallId, input }),
    )
  }

  logToolResult(sessionId: string, toolName: string, toolCallId: string, result: unknown): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      makeEvent(sessionId, "tool-result", { toolName, toolCallId, result }),
    )
  }

  logFileEdit(sessionId: string, filePath: string, before: string | undefined, after: string): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      makeEvent(sessionId, "file-edit", { filePath, before, after }),
    )
  }

  logDecision(sessionId: string, content: string, status: string): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      makeEvent(sessionId, "decision", { content, status }),
    )
  }

  logTurnStart(sessionId: string, turn: number): Effect.Effect<void> {
    return this.store.appendEvent(sessionId, makeEvent(sessionId, "turn-start", { turn }))
  }

  logTurnEnd(sessionId: string, turn: number, finishReason: string): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      makeEvent(sessionId, "turn-end", { turn, finishReason }),
    )
  }

  readLog(sessionId: string): Effect.Effect<readonly ContextEvent[]> {
    return this.store.readEvents(sessionId)
  }
}
