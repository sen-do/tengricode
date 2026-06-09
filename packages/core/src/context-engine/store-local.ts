import { Effect } from "effect"
import { Database } from "bun:sqlite"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import path from "path"
import {
  ContextEvent,
  ContextRecord,
  ContextRecordFilter,
  SemanticNotSupported,
  type MemoryStore,
} from "./store"

export class LocalMemoryStore implements MemoryStore {
  private db: Database
  private dataDir: string

  constructor(input: { dataDir: string; db?: Database }) {
    this.dataDir = input.dataDir
    this.db = input.db ?? new Database(":memory:")
    this.initDb()
  }

  private initDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS record_tags (
        record_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (record_id, tag)
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_records_type ON records(type)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_record_tags_tag ON record_tags(tag)`)
  }

  private sessionEventPath(sessionId: string): string {
    const dir = path.join(this.dataDir, "sessions", sessionId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return path.join(dir, "events.jsonl")
  }

  appendEvent(sessionId: string, event: ContextEvent): Effect.Effect<void> {
    return Effect.sync(() => {
      const filePath = this.sessionEventPath(sessionId)
      appendFileSync(filePath, JSON.stringify(event) + "\n")
    })
  }

  readEvents(sessionId: string): Effect.Effect<readonly ContextEvent[]> {
    return Effect.sync(() => {
      const filePath = this.sessionEventPath(sessionId)
      if (!existsSync(filePath)) return []
      const content = readFileSync(filePath, "utf-8")
      return content
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => ContextEvent.make(JSON.parse(line)))
    })
  }

  putRecord(record: ContextRecord): Effect.Effect<void> {
    return Effect.sync(() => {
      const insertRecord = this.db.prepare(`
        INSERT OR REPLACE INTO records (id, session_id, type, content, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const insertTag = this.db.prepare(`INSERT OR REPLACE INTO record_tags (record_id, tag) VALUES (?, ?)`)
      const deleteTags = this.db.prepare(`DELETE FROM record_tags WHERE record_id = ?`)

      insertRecord.run(
        record.id,
        record.session_id,
        record.type,
        record.content,
        JSON.stringify(record.metadata),
        record.timestamp,
      )
      deleteTags.run(record.id)
      for (const tag of record.tags) {
        insertTag.run(record.id, tag)
      }
    })
  }

  getRecord(id: string): Effect.Effect<ContextRecord | undefined> {
    return Effect.sync(() => {
      const row = this.db.prepare(`SELECT * FROM records WHERE id = ?`).get(id) as
        | Record<string, unknown>
        | undefined
      if (!row) return undefined
      return this.rowToRecord(row)
    })
  }

  listRecords(filter: ContextRecordFilter): Effect.Effect<readonly ContextRecord[]> {
    return Effect.sync(() => {
      const conditions: string[] = []
      const params: unknown[] = []

      if (filter.session_id) {
        conditions.push("r.session_id = ?")
        params.push(filter.session_id)
      }
      if (filter.type) {
        conditions.push("r.type = ?")
        params.push(filter.type)
      }

      let query = `SELECT DISTINCT r.* FROM records r`
      if (filter.tags && filter.tags.length > 0) {
        query += ` JOIN record_tags rt ON r.id = rt.record_id`
        conditions.push(`rt.tag IN (${filter.tags.map(() => "?").join(",")})`)
        params.push(...filter.tags)
      }

      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(" AND ")
      }
      query += ` ORDER BY r.timestamp DESC`

      const rows = this.db.prepare(query).all(...(params as any[])) as Record<string, unknown>[]
      return rows.map((row) => this.rowToRecord(row))
    })
  }

  querySemantic(_text: string, _k: number): Effect.Effect<readonly ContextRecord[], SemanticNotSupported> {
    return Effect.fail(new SemanticNotSupported({ message: "Semantic search is not supported by LocalMemoryStore" }))
  }

  private rowToRecord(row: Record<string, unknown>): ContextRecord {
    const id = row.id as string
    const tagRows = this.db.prepare(`SELECT tag FROM record_tags WHERE record_id = ?`).all(id) as {
      tag: string
    }[]
    return ContextRecord.make({
      id,
      session_id: row.session_id as string,
      type: row.type as string,
      content: row.content as string,
      metadata: JSON.parse(row.metadata as string),
      timestamp: row.timestamp as number,
      tags: tagRows.map((t) => t.tag),
    })
  }
}
