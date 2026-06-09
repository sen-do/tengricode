# Context Engine — Implementation Plan

Last updated: 2026-06-09

## Insertion Points (verified against actual code)

### Model-call sites (where the projection is assembled)

| Path | Function | Line | Role |
|---|---|---|---|
| V1: `packages/opencode/src/session/prompt.ts` | `runLoop` | 1133 | `while(true)` loop per session step. Assembles filtered messages via `filterCompactedEffect()` (1144), resolves tools (1278), converts to model messages via `toModelMessagesEffect()` (1330), calls `handle.process()` (1335) |
| V1: `packages/opencode/src/session/processor.ts` | `process` | 959 | Consumes `llm.stream(streamInput)` (973), dispatches events, returns `"compact"|"stop"|"continue"` |
| V1: `packages/opencode/src/session/llm.ts` | `run` | 83 | Orchestrates AI SDK `streamText({...})` (278) vs native runtime gate (224) |
| V2: `packages/core/src/session/runner/llm.ts` | `run` | 371 | Main entry. Inner step loop calls `runTurn` → `runTurnAttempt` (173) which constructs `LLM.request({...})` (217) and calls `llm.stream(request)` (243) |
| V2: `packages/core/src/session/runner/llm.ts` | `runTurnAttempt` | 173 | Loads history (214), builds request (217-225), streams (243), publishes events (244-280) |

### Existing compaction / overflow logic

| Path | Function | Line | Role |
|---|---|---|---|
| `packages/opencode/src/session/compaction.ts` | `processCompaction` | 298 | Main compaction: selects head/tail, builds prompt, streams to LLM, handles compact/stop/continue |
| `packages/opencode/src/session/compaction.ts` | `select` | 197 | Selects which messages go to compacted head vs preserved tail based on `tail_turns` and `preserve_recent_tokens` |
| `packages/opencode/src/session/compaction.ts` | `prune` | 252 | Erases old completed tool outputs (marks `time.compacted`) to free context |
| `packages/opencode/src/session/compaction.ts` | `create` | 553 | Creates a compaction request user message with a `compaction` part |
| `packages/opencode/src/session/overflow.ts` | `isOverflow` | 22 | Checks if token count exceeds `model.limit.input` minus reserved buffer |
| `packages/core/src/session/compaction.ts` | `buildPrompt` | 166 | Summarization template with sections: Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context, Relevant Files |
| V1: `packages/opencode/src/session/prompt.ts` | (in runLoop) | 1201-1219 | Triggers compaction.process() or compaction.create(auto:true) on overflow |

### AGENTS.md / instruction loader

| Path | Function | Line | Role |
|---|---|---|---|
| V1: `packages/opencode/src/session/instruction.ts` | `Instruction.system()` | 153 | Loads AGENTS.md/CLAUDE.md/CONTEXT.md via `findUp`, returns string arrays for system prompt |
| `packages/opencode/src/session/instruction.ts` | `systemPaths()` | 108 | Discovers instruction files: global AGENTS.md, project-local files, config.instructions |
| V2: `packages/core/src/instruction-context.ts` | `observe()` | 39 | Registers as SystemContext source under key `core/instructions` |
| `packages/core/src/system-context/index.ts` | (module) | 22 | Core abstraction: `Source<A>` with load/baseline/update/removed hooks |

### Todo / plan / task state

| Path | Function | Line | Role |
|---|---|---|---|
| `packages/opencode/src/session/todo.ts` | `update` / `get` | 42 / 66 | Persists todo items to `TodoTable` with status (pending/in_progress/completed/cancelled) and priority |
| `packages/core/src/session/sql.ts` | `TodoTable` | 99-116 | SQL schema: session_id, content, status, priority, position |

### Message / transcript persistence

| Path | Table/Function | Line | Role |
|---|---|---|---|
| `packages/core/src/session/sql.ts` | `SessionTable` | 21 | Session metadata |
| `packages/core/src/session/sql.ts` | `MessageTable` | 67 | V1 messages (JSON blob of `SessionV1.Info`) |
| `packages/core/src/session/sql.ts` | `PartTable` | 81 | V1 message parts (JSON blob) |
| `packages/core/src/session/sql.ts` | `SessionMessageTable` | 118 | V2 event-sourced messages with monotonic `seq` |
| `packages/core/src/session/sql.ts` | `SessionInputTable` | 139 | Durable prompt admission with `delivery` (steer/queue) |
| `packages/core/src/session/sql.ts` | `SessionContextEpochTable` | 167 | System context baseline/revision |
| `packages/core/src/session/history.ts` | `SessionHistory.load()` | 66 | Loads messages filtered by compaction/context epoch |
| `packages/core/src/session/store.ts` | `Service.get()` / `context()` | 27+ | Session retrieval, context loading |

### Config / feature flag system

| Path | What | Role |
|---|---|---|
| `packages/core/src/v1/config/config.ts` | `ConfigV1.Info` struct | Authoritative opencode.json schema. Parser rejects unknown keys. |
| `packages/core/src/config.ts` | `Config.Info` class (V2) | Parallel V2 config schema |
| `packages/core/src/flag/flag.ts` | `Flag` object | Runtime env-var flags, `truthy()` / `enabledByExperimental()` |
| `packages/opencode/src/config/config.ts` | `Config.Service` (line 132) | Loads/merges config from global, project, .opencode/, env; wires Flag overrides (566-571) |
| `packages/opencode/src/config/parse.ts` | `parse.schema()` (line 35) | Schema validation, rejects `unrecognized_keys` at top level |

### Config flag add pattern (3 files)
1. `packages/core/src/v1/config/config.ts` — add `Schema.optional(Schema.Boolean)` field to `Info` struct
2. `packages/core/src/flag/flag.ts` — add `Flag.OPENCODE_CONTEXT_ENGINE` using `enabledByExperimental()`
3. `packages/opencode/src/config/config.ts:566-571` — wire Flag override into config loading

---

## Phase Plan

All new files live under `packages/core/src/context-engine/` unless noted otherwise.
Feature flags live in `contextEngine` key within the config schema.

### Phase 1 — Foundation: storage ports, local adapter, instrumentation

**Flag:** `contextEngine.enabled` (default `false`)

**New files:**
- `packages/core/src/context-engine/store.ts` — `MemoryStore` interface (the port): `appendEvent(sessionId, event)`, `readEvents(sessionId)`, `putRecord(record)`, `getRecord(id)`, `listRecords(filter)`, `querySemantic(text, k)` (optional, may return "not supported")
- `packages/core/src/context-engine/store-local.ts` — `LocalMemoryStore` adapter: events → append-only JSONL file per session under `~/.opencode/context-engine/sessions/{id}/events.jsonl`; records → `bun:sqlite` tables (`records`, `record_tags`). **Only file allowed to import `bun:sqlite`.**
- `packages/core/src/context-engine/instrumentation.ts` — per-turn token counter + probe harness skeleton (4 probe types: fact recall, artifact tracking, decision recall, continuation; scored 0-5). Logs to `~/.opencode/context-engine/probes/`.
- `packages/core/src/context-engine/index.ts` — barrel export

**Schema changes:**
- `packages/core/src/v1/config/config.ts` — add `contextEngine` sub-struct with `enabled: Schema.optional(Schema.BooleanWithDefault(false))`

**Flag wiring:**
- `packages/core/src/flag/flag.ts` — add `OPENCODE_CONTEXT_ENGINE` using `enabledByExperimental()`

**Acceptance test:**
- Interface round-trips through the local adapter: append/read events, put/get/list records
- When flag is off, a normal session produces byte-identical behavior to stock OpenCode

---

### Phase 2 — Event log + projection rebuild **(COMPLETED)**

**Goal:** Make the message array a derived projection of an immutable event log.

**Flag:** Reuses `contextEngine.enabled`

**Built:**
- `packages/core/src/context-engine/event-log.ts` — `EventLog` class wrapping `MemoryStore` with typed logging: `logUserMessage`, `logAssistantText`, `logToolCall`, `logToolResult`, `logFileEdit`, `logDecision`, `logTurnStart`, `logTurnEnd`
- `packages/core/src/context-engine/projection.ts` — `rebuildProjection(events)` — identity function (returns events as-is for Phase 2)
- Hooked into V2: `packages/core/src/session/runner/llm.ts:108` — conditionally creates `EventLog` + `LocalMemoryStore` when config enables it. Logs tool-call (line 262) and tool-result (line 281) events during the provider turn loop.
- V1 hook: **skipped** — V2-only for Phase 2; V1 processor hook deferred
- Added `contextEngine` to V2 `Config.Info` schema: `packages/core/src/config.ts:88-93`

**Verification:**
- 10 new event-log + projection tests pass
- All 91 existing session-runner tests pass
- Core + opencode packages typecheck clean
- With flag off: zero behavior change (runner creates no store, logs nothing)

---

### Phase 3 — Anchored structured summarization + anchor pinning

**Goal:** Replace blob compaction with structured summary that preserves critical info.

**Flag:** `contextEngine.summary = "structured"` (vs default `"off"`)

**New/changed files:**
- `packages/core/src/context-engine/summary.ts` — structured summary with fixed sections: task intent, files modified, decisions + rationale, open tasks, next steps. Implements **incremental merge** — fold only the newly truncated span into existing summary, never regenerate from scratch.
- `packages/core/src/context-engine/anchor.ts` — anchor registry: task intent and explicit constraints (e.g. "don't touch X") are pinned and never evicted
- Modify `packages/core/src/session/compaction.ts` — when `contextEngine.summary === "structured"`, use the structured summarizer instead of the blob `buildPrompt()` template
- Modify `packages/opencode/src/session/compaction.ts` — skip `processCompaction()` when structured summary is enabled, use new flow

**Acceptance test:**
- On a recorded long session, four probe scores >= Phase-0 baseline
- Pinned constraints present in the projection after compaction

---

### Phase 4 — Liveness-based eviction

**Goal:** Distinguish "still causally active" from "completed" by reachability from open tasks.

**Flag:** `contextEngine.liveness` (default `false`)

**New/changed files:**
- `packages/core/src/context-engine/liveness.ts` — derive a task graph from `TodoTable` state (source: `packages/core/src/session/sql.ts:99-116`). Backward reachability pass: an item is **live** if an open task (status != completed/cancelled) could still reference it. **Dead** items (no open dependents) are consolidated. Start with unambiguous case: file read → successful edit → green test collapses to one record.
- Integrate into projection rebuild in `packages/core/src/context-engine/projection.ts` — skip dead items when `contextEngine.liveness` is true
- Integrate into `packages/opencode/src/session/prompt.ts` `runLoop` at message filtering step (1144)

**Acceptance test:**
- Fixture session where a constraint set at turn 2 stays live across 30 simulated turns
- A resolved file-read collapses out of the active set

---

### Phase 5 — Local recall tier

**Goal:** Completed work leaves the active set but stays retrievable.

**Flag:** `contextEngine.recall` (default `false`); sub-flag `contextEngine.recall.semantic` (default `false`)

**New/changed files:**
- `packages/core/src/context-engine/recall.ts` — on dead-classification, write structured record to SQLite: file manifest (what was touched, when) and decision log (artifact-tracking layer). Retrieval function: structured exact lookup first, semantic second with conservative top-k.
- `packages/core/src/context-engine/recall-semantic.ts` — optional semantic recall behind sub-flag: embed records via local Ollama (`nomic-embed-text`) into local vector index. If Ollama unavailable, degrade gracefully to structured-only. Uses `MemoryStore.querySemantic()` which `LocalMemoryStore` implements.
- Integrate retrieval call before each model call:
  - V2: `packages/core/src/session/runner/llm.ts` — before `LLM.request()` at line 217
  - V1: `packages/opencode/src/session/prompt.ts` — before `toModelMessagesEffect()` at line 1330

**Acceptance test:**
- A decision recorded at turn 3 is retrievable at turn 40
- An unrelated query returns nothing (precision probe)

---

### Phase 6 — Eviction policy: ARC + decay + ghost lists

**Goal:** Principled active-set eviction that recovers from mistakes.

**Flag:** `contextEngine.policy = "arc"` (vs default `"off"`)

**New/changed files:**
- `packages/core/src/context-engine/eviction.ts` — ARC-style policy (recency + frequency). Each item carries a decay weight, boosted on retrieval/reference, decaying otherwise. Ghost list: metadata-only summaries of evicted items for re-fetch detection.
- Integrate into projection rebuild and liveness analysis

**Acceptance test:**
- A frequently-referenced item survives eviction
- A one-off item decays out
- A ghost-list hit triggers re-fetch from recall tier

---

### Phase 7 — Offline consolidation → AGENTS.md

**Goal:** Turn episodic session detail into durable project knowledge.

**Flag:** `contextEngine.consolidate` (default `false`)

**New/changed files:**
- `packages/core/src/context-engine/consolidate.ts` — between-sessions pass (via command, e.g. `opencode consolidate`) that replays the event log, clusters completed units by similarity, distills durable knowledge into a managed section of `AGENTS.md`. Decay-weighted: frequently retrieved items survive; never-retrieved items compress further.
- Integrate with `packages/opencode/src/session/instruction.ts` `Instruction.system()` (153) — ensure managed section is loaded alongside regular instructions

**Acceptance test:**
- A convention applied repeatedly within a session appears in the managed AGENTS.md section after running consolidation

---

## Integration Notes

### V1 vs V2 paths
All phases must support both the V1 AI SDK path (`packages/opencode/src/session/`) and the V2 native runtime path (`packages/core/src/session/runner/`). Where the two paths diverge, the context engine layer in `packages/core/src/context-engine/` provides a shared implementation that both paths call.

### Effect pattern
All new services follow the existing Effect conventions:
- `Context.Service<Service, Interface>()` for service classes
- `Layer.effect(Service, ...)` for layer construction
- `Effect.fn("Domain.method")` for named effects
- Self-reexport pattern: `export * as ContextEngine from "./context-engine/..."`

### Feature flag default
All flags default to `false`/`"off"`. With all flags off, OpenCode's behavior is byte-identical to stock. Flags are additive: `liveness` requires `enabled`, `recall` requires `liveness`, etc.

### Testing
- Tests live in `packages/core/test/context-engine/`
- Use `testEffect(...)` from `packages/opencode/test/lib/effect.ts` for Effect tests
- Prefer live behavior tests over mocks
- Fixture sessions stored as JSONL event logs in `packages/core/test/context-engine/fixtures/`
