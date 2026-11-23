# Session Persistence (Interface + JSON) Implementation Plan

## Overview

Add durable paper-trading session storage behind a storage-agnostic `ISessionRepository` so a learner can explicitly Save a full sim snapshot, list past sessions, and Load one into Diary for read-only review. Ship a JSON-file implementation now; keep the interface ready for an Azure Table implementation in a later change. Replace the pre-play Dashboard strip with a session entry screen that offers **Start session** and **Load session**.

## Current State Analysis

- Pre-play setup (symbol, last N days, Load/Refresh, session start date, starting balance, Play) lives on `Dashboard`; first Play sets `sessionLocked` (`SessionContext.handlePlay`).
- Lots, pending orders, closed trades, and PnL live only in React state — reload wipes them. Coach receives closed trades via POST but never persists them.
- The only durable store today is candle packs: `ICandlePackRepository` → `JsonCandlePackRepository` under `data/candles/` (atomic `.tmp` + move, camelCase JSON, options + DI in `Program.cs`).
- Routes are `/` (Dashboard) and `/diary` only. Diary is gated on `sessionLocked` and reads live session state.
- Roadmap S-03 (`sim-open-close-positions`) already delivered open/close; this change is net-new persistence + entry UX (folder id `positon-handling`).

## Desired End State

A learner configures a session on a dedicated entry screen, starts a new sim or loads a previously saved session into Diary (read-only). During a live sim they can Save; saving again in the same session overwrites the same session id. Backend stores full snapshots via `ISessionRepository` with a JSON-file implementation selectable in DI. Azure Table is not implemented yet but requires no interface redesign.

### Key Discoveries:

- Copy storage patterns from `backend/TradingTutor.Trading/Storage/JsonCandlePackRepository.cs` and `Interfaces/ICandlePackRepository.cs`.
- Frontend domain types for lots/orders/closed trades already exist in `frontend/src/trading/types.ts` — snapshot DTOs should mirror them.
- Diary already renders closed trades + open lots when hydrated from `SessionContext`; import path should feed the same shapes without unlocking trading.
- No roadmap row for `positon-handling` — leave `context/foundation/roadmap.md` untouched.

## What We're NOT Doing

- Azure Table implementation (later change; interface must allow it)
- Public `AddPosition` API — Save writes the full snapshot via `CreateSession` (upsert)
- Resuming a saved session into the live Dashboard trading UI (Load → Diary read-only only)
- Embedding full OHLC candle series in the session file (store candle **refs** only; reload packs on review)
- Leverage, margin, fees, live exchange orders
- Auth / multi-user tenancy
- Auto-save on every trade or on analyze
- Playwright / component e2e harness

## Implementation Approach

1. Define Core models for a session snapshot + list item.
2. Define `ISessionRepository` with Create (upsert), Get, List — no Azure-specific types on the port.
3. Implement `JsonSessionRepository` beside the candle JSON repo.
4. Expose thin REST endpoints; register JSON impl as the sole DI binding for now.
5. Split pre-play UI onto a session entry screen (Start / Load).
6. Wire explicit Save (active session id + overwrite) and Load → Diary hydrate.

---

## Phase 1: Domain models + `ISessionRepository`

### Overview

Introduce the session snapshot contract and storage port so JSON (now) and Azure Table (later) share one API.

### Changes Required:

#### 1. Core session models

**File**: `backend/TradingTutor.Core/Models/TradingSession.cs` (and small related types as needed)

**Intent**: Define the durable session aggregate: identity/metadata plus full sim snapshot (lots, pending orders, closed trades, realized PnL, starting balance, playhead, symbol/interval/exchange/range refs, session start date, locked flag as recorded at save time).

**Contract**: Models must round-trip through System.Text.Json camelCase like `ClosedTradeInput`. Include a list/summary type (id, created/updated timestamps, symbol, closed-trade count, starting balance) suitable for `ListSessions` without loading full blobs. Candle data is referenced, not embedded.

#### 2. Repository interface

**File**: `backend/TradingTutor.Trading/Interfaces/ISessionRepository.cs`

**Intent**: Storage-agnostic port for session persistence. Azure Table must be addable later as another class implementing this interface — no file-path or Azure SDK types on the port.

**Contract**:
- `CreateSessionAsync(TradingSession session, …)` — insert or **overwrite** by `session.Id` (full snapshot replace)
- `GetSessionAsync(string id, …)` — returns session or null
- `ListSessionsAsync(…)` — returns summary items, newest-first (or stable documented order)
- Do **not** expose `AddPosition` on this interface for MVP

### Success Criteria:

#### Automated Verification:

- Solution builds: `dotnet build TradingTutor.slnx`
- New models/interface compile and are referenced from the Trading project

#### Manual Verification:

- Interface surface reviewed: Create/Get/List only; no Azure or filesystem types leak into the port

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: JSON file repository

### Overview

Ship the first `ISessionRepository` implementation using atomic JSON files, matching candle-pack storage conventions.

### Changes Required:

#### 1. Storage options

**File**: `backend/TradingTutor.Trading/Options/SessionStorageOptions.cs`

**Intent**: Configure the JSON root path (default e.g. `data/sessions`), parallel to `CandleStorageOptions`.

**Contract**: Options section name + `RootPath` property; bindable from `appsettings.json`.

#### 2. JSON repository

**File**: `backend/TradingTutor.Trading/Storage/JsonSessionRepository.cs`

**Intent**: Persist one session per file; Create overwrites the same id; Get/List read from disk safely.

**Contract**: Follow `JsonCandlePackRepository` patterns — camelCase indented JSON, semaphore, write to `.tmp` then `File.Move`, path sanitization for ids. List derives summaries from stored sessions (or lightweight index if needed — prefer simplest approach that stays correct). Missing id → null; corrupt file → fail clearly (throw or null + log; pick one and test it).

#### 3. Unit tests

**File**: `tests/TradingTutor.Tests/JsonSessionRepositoryTests.cs`

**Intent**: Prove Create/Get/List and overwrite semantics without the API host.

**Contract**: Temp-directory fixtures (same style as `JsonCandlePackRepositoryTests`). Cover: create → get equality; second Create same id overwrites; list includes summaries; get missing returns null.

### Success Criteria:

#### Automated Verification:

- `dotnet test --filter JsonSessionRepositoryTests` passes
- `dotnet build TradingTutor.slnx` passes

#### Manual Verification:

- After a local Create, a JSON file appears under the configured sessions root and is human-readable

---

## Phase 3: HTTP API + DI (JSON binding)

### Overview

Expose session persistence over HTTP and register the JSON implementation as the current `ISessionRepository`. Document (comment or brief options note) that a future Azure Table class binds the same interface.

### Changes Required:

#### 1. Controller

**File**: `backend/TradingTutor.API/Controllers/SessionsController.cs`

**Intent**: Thin REST surface for create/upsert, get, and list — no business logic beyond validation and Problem details.

**Contract** (suggested routes; keep consistent with existing `/api/...` style):
- `POST /api/sessions` — body = full `TradingSession`; Create upsert; return id + metadata
- `GET /api/sessions` — list summaries
- `GET /api/sessions/{id}` — full session or 404
- Validate required fields; map missing get to 404

#### 2. DI + configuration

**Files**: `backend/TradingTutor.API/Program.cs`, `backend/TradingTutor.API/appsettings.json` (and Development variant if used)

**Intent**: Register `SessionStorageOptions` and `ISessionRepository` → `JsonSessionRepository` only.

**Contract**: Same registration style as candle storage (`Configure` + `AddSingleton` or scoped matching candle repo lifetime). No Azure packages or conditional providers in this change — a one-line comment near the registration is enough to mark the swap point for a later change.

#### 3. API-level tests

**File**: `tests/TradingTutor.Tests/` (controller/service tests with in-memory fake `ISessionRepository`, or WebApplicationFactory only if already used — prefer fake behind a thin service if that matches project norms)

**Intent**: Cover overwrite, list, get, and 404 without depending on disk when possible.

**Contract**: At minimum, fake-backed tests for upsert and missing get. If the project has no API host test pattern, keep tests on a small `SessionService` orchestrator called by the controller — do not invent a heavy e2e harness.

### Success Criteria:

#### Automated Verification:

- `dotnet test` (session-related tests) passes
- `dotnet build TradingTutor.slnx` passes

#### Manual Verification:

- Swagger/OpenAPI or HTTP client: POST session → GET by id → POST same id overwrites → GET list shows one entry

---

## Phase 4: Session entry UI (Start + Load)

### Overview

Move pre-play settings off the trading Dashboard onto a session entry screen with **Start session** and **Load session**.

### Changes Required:

#### 1. Routing

**File**: `frontend/src/App.tsx`

**Intent**: Entry screen is the default gate; trading Dashboard is reached after Start (or equivalent locked navigation).

**Contract**: Add a route for the session entry screen (e.g. `/` or `/session`); Dashboard moves to a post-start route (e.g. `/trade`) or stays mounted only when a “live session” flag is set — pick the smaller diff that preserves `/diary`. Unknown routes still redirect sensibly.

#### 2. Session entry screen

**File**: `frontend/src/components/` (new component, e.g. `SessionEntryPage.tsx`)

**Intent**: Host today’s pre-play controls (symbol, last N days, Load/Refresh, session start date, starting balance) plus **Start session** and **Load session**.

**Contract**:
- **Start session** — locks the sim session (today’s first-Play lock semantics) and navigates into the trading UI; may or may not auto-start playback — prefer lock + navigate, leave Play on Dashboard unless product copy requires auto-play
- **Load session** — fetches `GET /api/sessions`, shows a simple list (time, symbol, trade count), on pick `GET /api/sessions/{id}` and navigates to Diary in **imported/read-only** mode
- Remove or disable the duplicated pre-play strip from Dashboard once moved

#### 3. SessionContext adjustments

**File**: `frontend/src/session/SessionContext.tsx`

**Intent**: Support “started from entry screen” vs “imported for review” without breaking live trading.

**Contract**: Expose actions needed for Start (lock + carry setup state) and for applying an imported snapshot into review state used by Diary. Trading remains gated by live `sessionLocked` + mark; imported review must not enable the order ticket.

#### 4. API client

**File**: `frontend/src/services/api.ts`

**Intent**: Add typed helpers for list/get sessions (Save wiring can land in Phase 5 if cleaner).

**Contract**: Relative `/api/sessions` calls consistent with existing `fetchCandles` / coach helpers.

### Success Criteria:

#### Automated Verification:

- Frontend typecheck/tests still pass: `npm test` (and existing Vitest suites)
- No new oxlint/type errors in touched files

#### Manual Verification:

- Cold open shows session entry screen with setup controls
- **Start session** enters Dashboard with trading unlock rules intact (Play/lock/mark as today)
- **Load session** lists saved sessions (empty state OK) and selecting one opens Diary without enabling trade controls

---

## Phase 5: In-sim Save + Diary import hydrate

### Overview

Add explicit Save on the live sim (overwrite same active session id) and finish Diary hydration from a loaded snapshot (markers/tables from saved lots + closed trades; candles reloaded via refs).

### Changes Required:

#### 1. Save control + active session id

**Files**: `frontend/src/session/SessionContext.tsx`, `frontend/src/components/Dashboard.tsx` (or account strip)

**Intent**: Explicit Save posts the full snapshot; first Save creates an id client-side (or accepts server-generated id from response); subsequent Saves in the same live session reuse that id so Create upserts/overwrites.

**Contract**: Snapshot includes full sim fields from Phase 1 models. Save allowed after session lock (empty trades OK). Surface success/error to the user. Clear `activeSessionId` when starting a brand-new session from the entry screen.

#### 2. Diary imported mode

**Files**: `frontend/src/components/DiaryPage.tsx`, diary marker/span builders as needed

**Intent**: When navigated from Load session, Diary renders the imported snapshot read-only (closed trades, open lots, markers/spans). Coach analyze may use imported closed trades if ≥5 — same payload shape as live.

**Contract**: Do not mutate imported data via trading APIs. If candles are missing for refs, show a clear load error rather than empty chart silently. Live Diary path (from an active started session) remains unchanged.

#### 3. Frontend client Save

**File**: `frontend/src/services/api.ts`

**Intent**: `createSession` / upsert POST helper used by Save.

**Contract**: Matches Phase 3 POST body; returns id for `activeSessionId` retention.

### Success Criteria:

#### Automated Verification:

- `dotnet test` passes
- `npm test` passes

#### Manual Verification:

- Start session → trade (optional) → Save → Save again → only one list entry; GET shows latest snapshot
- Load session → Diary shows saved trades/lots; trading UI not enabled from that import
- New Start session after a Save starts a fresh live session (new id on next Save)

---

## Testing Strategy

### Unit Tests:

- `JsonSessionRepository`: create/get, overwrite, list, missing id
- Optional fake `ISessionRepository` for controller/orchestrator tests

### Integration Tests:

- Manual HTTP round-trip (Phase 3) and Save → List → Diary (Phase 5); no new Playwright suite

### Manual Testing Steps:

1. Entry screen: configure symbol/days/balance, Load candles, Start session → trade UI works as before
2. Save twice in one session → list shows one session; contents match last save
3. Restart app → Load session → Diary review matches snapshot; cannot open orders from import
4. Start a new session → Save → second list entry appears

## Performance Considerations

Session JSON files are small (positions/orders/trades + refs). List should avoid loading unnecessary candle data (there is none embedded). No caching layer required for MVP.

## Migration Notes

No existing session files. Candle packs unchanged. If empty or corrupt session files appear during List, skip or surface error consistently with Phase 2 contract — document the choice in the implementation PR/commit message.

## References

- Candle storage pattern: `backend/TradingTutor.Trading/Storage/JsonCandlePackRepository.cs`
- Candle port: `backend/TradingTutor.Trading/Interfaces/ICandlePackRepository.cs`
- Frontend trade types: `frontend/src/trading/types.ts`
- Session owner: `frontend/src/session/SessionContext.tsx`
- Prior position work: `context/changes/s-03/plan.md`
- Deferred: Azure Table `ISessionRepository` implementation (future change)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Domain models + ISessionRepository

#### Automated

- [x] 1.1 Solution builds: `dotnet build TradingTutor.slnx`
- [x] 1.2 New models/interface compile and are referenced from the Trading project

#### Manual

- [x] 1.3 Interface surface reviewed: Create/Get/List only; no Azure or filesystem types leak into the port

### Phase 2: JSON file repository

#### Automated

- [x] 2.1 `dotnet test --filter JsonSessionRepositoryTests` passes
- [x] 2.2 `dotnet build TradingTutor.slnx` passes

#### Manual

- [x] 2.3 After a local Create, a JSON file appears under the configured sessions root and is human-readable

### Phase 3: HTTP API + DI (JSON binding)

#### Automated

- [x] 3.1 `dotnet test` (session-related tests) passes
- [x] 3.2 `dotnet build TradingTutor.slnx` passes

#### Manual

- [x] 3.3 Swagger/OpenAPI or HTTP client: POST session → GET by id → POST same id overwrites → GET list shows one entry

### Phase 4: Session entry UI (Start + Load)

#### Automated

- [x] 4.1 Frontend typecheck/tests still pass: `npm test` (and existing Vitest suites)
- [x] 4.2 No new oxlint/type errors in touched files

#### Manual

- [x] 4.3 Cold open shows session entry screen with setup controls
- [x] 4.4 Start session enters Dashboard with trading unlock rules intact
- [x] 4.5 Load session lists saved sessions and selecting one opens Diary without enabling trade controls

### Phase 5: In-sim Save + Diary import hydrate

#### Automated

- [x] 5.1 `dotnet test` passes
- [x] 5.2 `npm test` passes

#### Manual

- [x] 5.3 Start session → trade (optional) → Save → Save again → only one list entry; GET shows latest snapshot
- [x] 5.4 Load session → Diary shows saved trades/lots; trading UI not enabled from that import
- [x] 5.5 New Start session after a Save starts a fresh live session (new id on next Save)
