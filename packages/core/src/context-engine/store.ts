import { Effect, Schema } from "effect"

export class ContextEvent extends Schema.Class<ContextEvent>("ContextEvent")({
  id: Schema.String,
  session_id: Schema.String,
  type: Schema.String,
  timestamp: Schema.Number,
  data: Schema.Unknown,
}) {}

export class ContextRecord extends Schema.Class<ContextRecord>("ContextRecord")({
  id: Schema.String,
  session_id: Schema.String,
  type: Schema.String,
  content: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  tags: Schema.mutable(Schema.Array(Schema.String)),
  timestamp: Schema.Number,
}) {}

export class ContextRecordFilter extends Schema.Class<ContextRecordFilter>("ContextRecordFilter")({
  session_id: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
}) {}

export class SemanticNotSupported extends Schema.TaggedErrorClass<SemanticNotSupported>()("SemanticNotSupported", {
  message: Schema.String,
}) {}

export interface MemoryStore {
  appendEvent(sessionId: string, event: ContextEvent): Effect.Effect<void>
  readEvents(sessionId: string): Effect.Effect<readonly ContextEvent[]>
  putRecord(record: ContextRecord): Effect.Effect<void>
  getRecord(id: string): Effect.Effect<ContextRecord | undefined>
  listRecords(filter: ContextRecordFilter): Effect.Effect<readonly ContextRecord[]>
  querySemantic(text: string, k: number): Effect.Effect<readonly ContextRecord[], SemanticNotSupported>
}
