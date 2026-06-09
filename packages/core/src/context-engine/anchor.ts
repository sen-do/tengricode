import { Schema } from "effect"

export class Anchor extends Schema.Class<Anchor>("ContextEngineAnchor")({
  id: Schema.String,
  type: Schema.Literals(["constraint", "task-intent", "decision"]),
  content: Schema.String,
  pinned: Schema.Boolean,
  timestamp: Schema.Number,
}) {}

export class AnchorRegistry {
  private items: Map<string, Anchor> = new Map()

  pin(id: string, type: Anchor["type"], content: string): Anchor {
    const anchor = Anchor.make({ id, type, content, pinned: true, timestamp: Date.now() })
    this.items.set(id, anchor)
    return anchor
  }

  unpin(id: string): void {
    const existing = this.items.get(id)
    if (existing) this.items.set(id, Anchor.make({ ...existing, pinned: false }))
  }

  get(id: string): Anchor | undefined {
    return this.items.get(id)
  }

  active(): Anchor[] {
    return [...this.items.values()].filter((a) => a.pinned)
  }

  all(): Anchor[] {
    return [...this.items.values()]
  }

  clear(): void {
    this.items.clear()
  }

  snapshot(): readonly Anchor[] {
    return [...this.items.values()]
  }

  restore(items: readonly Anchor[]): void {
    this.items.clear()
    for (const item of items) this.items.set(item.id, item)
  }
}
