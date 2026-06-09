import { Effect, Schema } from "effect"
import path from "path"
import { appendFileSync, existsSync, mkdirSync } from "fs"

export const ProbeType = Schema.Literals(["fact-recall", "artifact-tracking", "decision-recall", "continuation"])
export type ProbeType = Schema.Schema.Type<typeof ProbeType>

export class ProbeScore extends Schema.Class<ProbeScore>("ProbeScore")({
  probe_type: ProbeType,
  score: Schema.Number,
  session_id: Schema.String,
  turn: Schema.Number,
  timestamp: Schema.Number,
}) {}

export class TokenCount extends Schema.Class<TokenCount>("TokenCount")({
  session_id: Schema.String,
  turn: Schema.Number,
  input_tokens: Schema.Number,
  output_tokens: Schema.Number,
  total_tokens: Schema.Number,
  timestamp: Schema.Number,
}) {}

export class Instrumentation {
  private dataDir: string

  constructor(input: { dataDir: string }) {
    this.dataDir = input.dataDir
  }

  private ensureDir() {
    const dir = path.join(this.dataDir, "probes")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  recordTokenCount(count: TokenCount): Effect.Effect<void> {
    return Effect.sync(() => {
      this.ensureDir()
      const filePath = path.join(this.dataDir, "probes", `${count.session_id}.token.jsonl`)
      appendFileSync(filePath, JSON.stringify(count) + "\n")
    })
  }

  recordProbeScore(score: ProbeScore): Effect.Effect<void> {
    return Effect.sync(() => {
      this.ensureDir()
      const filePath = path.join(this.dataDir, "probes", `${score.session_id}.probe.jsonl`)
      appendFileSync(filePath, JSON.stringify(score) + "\n")
    })
  }
}
