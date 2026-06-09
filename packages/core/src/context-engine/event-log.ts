import { Effect } from "effect"
import { ContextEvent, type MemoryStore } from "./store"

export class EventLog {
  private seq = 0

  constructor(readonly store: MemoryStore) {}

  private nextId(): string {
    return `ctx_${++this.seq}_${Date.now()}`
  }

  private makeEvent(sessionId: string, type: string, data: unknown): ContextEvent {
    return ContextEvent.make({
      id: this.nextId(),
      session_id: sessionId,
      type,
      timestamp: Date.now(),
      data,
    })
  }

  logUserMessage(sessionId: string, content: string): Effect.Effect<void> {
    return this.store.appendEvent(sessionId, this.makeEvent(sessionId, "user-message", { content }))
  }

  logAssistantText(sessionId: string, content: string): Effect.Effect<void> {
    return this.store.appendEvent(sessionId, this.makeEvent(sessionId, "assistant-text", { content }))
  }

  logToolCall(sessionId: string, toolName: string, toolCallId: string, input: unknown): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      this.makeEvent(sessionId, "tool-call", { toolName, toolCallId, input }),
    )
  }

  logToolResult(sessionId: string, toolName: string, toolCallId: string, result: unknown): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      this.makeEvent(sessionId, "tool-result", { toolName, toolCallId, result }),
    )
  }

  logFileEdit(sessionId: string, filePath: string, before: string | undefined, after: string): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      this.makeEvent(sessionId, "file-edit", { filePath, before, after }),
    )
  }

  logDecision(sessionId: string, content: string, status: string): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      this.makeEvent(sessionId, "decision", { content, status }),
    )
  }

  logTurnStart(sessionId: string, turn: number): Effect.Effect<void> {
    return this.store.appendEvent(sessionId, this.makeEvent(sessionId, "turn-start", { turn }))
  }

  logTurnEnd(sessionId: string, turn: number, finishReason: string): Effect.Effect<void> {
    return this.store.appendEvent(
      sessionId,
      this.makeEvent(sessionId, "turn-end", { turn, finishReason }),
    )
  }

  readLog(sessionId: string): Effect.Effect<readonly ContextEvent[]> {
    return this.store.readEvents(sessionId)
  }
}
