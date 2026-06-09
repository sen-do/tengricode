import type { ContextEvent } from "./store"

export function rebuildProjection(events: readonly ContextEvent[]): readonly ContextEvent[] {
  return events
}
