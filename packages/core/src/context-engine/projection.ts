import type { ContextEvent } from "./store"
import { analyzeLiveness } from "./liveness"

export interface ProjectionOptions {
  readonly liveness?: boolean
}

export function rebuildProjection(
  events: readonly ContextEvent[],
  options?: ProjectionOptions,
): readonly ContextEvent[] {
  if (!options?.liveness) return events
  const { live } = analyzeLiveness(events)
  return live
}
