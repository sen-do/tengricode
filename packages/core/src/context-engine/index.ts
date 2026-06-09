export * as ContextEngine from "./index"

export { ContextEvent, ContextRecord, ContextRecordFilter, SemanticNotSupported, type MemoryStore } from "./store"
export { LocalMemoryStore } from "./store-local"
export { EventLog } from "./event-log"
export { rebuildProjection } from "./projection"
export type { ProjectionOptions } from "./projection"
export {
  StructuredSummary,
  Decision,
  FileEntry,
  emptySummary,
  mergeSummary,
  buildStructuredPrompt,
  serializeSummary,
} from "./summary"
export { AnchorRegistry, Anchor } from "./anchor"
export { analyzeLiveness, consolidateEvents } from "./liveness"
export { Instrumentation, ProbeScore, TokenCount, ProbeType } from "./instrumentation"
