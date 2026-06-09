# Context Engine — Deferred Extension Points

These are future capabilities that MUST require zero engine changes when added later — only new code behind the existing interfaces.

## Remote Storage Adapters

**Plug into:** `MemoryStore` interface (`packages/core/src/context-engine/store.ts`)

- `QdrantStore` — implements `MemoryStore` with Qdrant vector DB for `querySemantic()`. Drops in by providing a new adapter. No engine code changes.
- `SupabaseStore` — implements `MemoryStore` with Supabase (pgvector) for records + semantic search. Same drop-in pattern.

The `LocalMemoryStore` adapter in Phase 1 is the reference implementation. Every method in `MemoryStore` must be implementable by a remote adapter without changing the interface signature.

## Graph-Traversal Retrieval

**Plug into:** `querySemantic(text, k)` method on `MemoryStore` interface

Upgrading semantic recall from flat vector search to entity/edge traversal happens entirely within the adapter. The engine calls `querySemantic()` and receives results — it doesn't know or care whether the adapter uses flat cosine similarity or graph traversal.

## ACON Failure-Driven Tuning

**Plug into:** Probe harness in `packages/core/src/context-engine/instrumentation.ts`

Mining probe logs for compaction-induced regressions to auto-refine what the summarizer must preserve. The probe harness is built in Phase 1 to emit structured logs; the offline analysis and auto-tuning loop reads those logs without touching engine code.

## Explicit Non-Goals (do not implement)

These are NOT planned for any phase:
- Real-time remote sync between `LocalMemoryStore` and remote adapters
- Multi-user shared context
- Cross-session semantic search across different project directories
- Fine-tuning the compaction model based on probe scores (online learning)
