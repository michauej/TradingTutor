# Frontend-to-backend Thin Client Implementation Plan

## Overview

Move paper-trading calculation and live session truth to the ASP.NET backend so the React UI is a thin client: create a session on Start, send trade/advance commands, render server state, and run coach analyze by `sessionId` with results persisted on the session.

## Current State Analysis

- Candles (load + durable packs) and coach rules/LLM already run on the backend (`DataController`, `CandleLoadService`, `CoachAnalyzeService`).
- Session Save/Load persists JSON snapshots via `SessionsController` / `SessionService`, but the client builds the snapshot — the API does not recompute PnL or fills.
- The paper engine lives entirely in `frontend/src/trading/trading.ts`, orchestrated by `SessionContext.tsx` (open/close, soft-cap, `matchLimits` on play ticks).
- Playback clock stays client-side by design (S-02); this plan keeps the timer on the FE and moves fill matching into a server `advance` command.
- Research (`research.md`) and follow-up theory settled: thin client, trust boundary, commands not client-built money truth.
- Locked planning answers: **full thin client (M1–M5 + M6/M7)**; **create session on Start** (not local-until-Save).

## Desired End State

After Start, the learner has a server-owned session id. Play advances call `POST /api/sessions/{id}/advance` with absolute `toPlayhead`; the server loads candle OHLC from packs, runs `MatchLimits` for new bars, persists, and returns full session state. Open/close/orders go through command endpoints; mark price and soft-cap are enforced server-side. Diary Analyze posts only `sessionId`; coach loads closed trades from storage, runs rules+LLM, and saves verdict/analysis/findings onto the session. Refresh/review reloads the same positions and coach result. Chart/diary projections remain client-side from server state.

### Key Discoveries:

- Engine source of truth to port: `frontend/src/trading/trading.ts` with parity tests in `frontend/src/trading/trading.test.ts`.
- Session model already has lots/orders/closed trades: `backend/TradingTutor.Core/Models/TradingSession.cs` — extend with coach result fields.
- Candle packs via `ICandleLoadService` are available for server-side mark and advance fills — do not trust client OHLC for money math.
- Prior S-02/S-03 intentionally kept the engine on the FE; this change reverses that for calc ownership.

## What We're NOT Doing

- Auth / multi-user
- WebSockets / server wall-clock playback
- Embedding candles in session JSON
- Porting diary markers/spans/chart rendering to the backend
- ICT structure detection APIs
- Session delete/rename UI (unless required to fix broken shells)
- Keeping client `buildSnapshot` as authoritative trading write

## Implementation Approach

1. Port pure trading math to C# with test parity (gate for later phases).
2. Replace snapshot-as-authority `POST /api/sessions` with Start metadata + command APIs; persist after every command.
3. Rewire `SessionContext` / `api.ts` to commands; client timer only decides when to call advance.
4. Coach by `sessionId` + persist results on `TradingSession`; remove trades-body analyze path.
5. Clean up duplicated max-bars / min-trades drift (server authority).

## Critical Implementation Details

### Timing & lifecycle

Create the server session at Start (empty lots, server-assigned id). Persist after every successful command — there is no separate “Save builds truth” path. Client play timer may fire while an advance is in flight: allow at most one in-flight advance per session and serialize trade commands with advances (simple per-session lock in the service) so fills and user opens do not race.

### State sequencing

1. Start → server creates session → FE holds `activeSessionId` + returned state.
2. Lock on first Play via `POST .../lock` (or include lock in first advance) — mirror today’s `sessionLocked` semantics.
3. Each timer tick: compute next playhead locally → `advance({ toPlayhead })` → apply returned state (do not locally `matchLimits`).
4. Market open/close/orders: command → apply returned state.
5. Coach: only after session exists; analyze loads `ClosedTrades` from store; write coach fields back to the same JSON.

### Performance constraints

Use absolute `toPlayhead` batch advance (one HTTP call per timer tick, not per-bar HTTP). Large jumps must run `MatchLimits` for each intermediate bar server-side in that single request.

---

## Phase 1: PaperTradingEngine (C#) + parity tests

### Overview

Port pure trading math from the frontend module into `TradingTutor.Trading` and prove parity with existing Vitest cases.

### Changes Required:

#### 1. Paper trading engine

**File**: `backend/TradingTutor.Trading/Services/PaperTradingEngine.cs` (and small result/helper types as needed)

**Intent**: Own soft-cap, PnL, open/close FIFO, close-all, close-qty, place/cancel limit-stop, and `MatchLimits` so session commands share one domain implementation.

**Contract**: Mirror behaviors in `frontend/src/trading/trading.ts`: sizing reject reasons (`invalid` / `softCapExceeded`), lot/order/closed-trade shapes aligned with `SessionLot` / `SessionOrder` / `ClosedTradeInput`, OHLC bar touch rules for limit and stop, fill price = trigger, id factory injectable for tests.

#### 2. Parity unit tests

**File**: `tests/TradingTutor.Tests/PaperTradingEngineTests.cs`

**Intent**: Gate Phase 2 on behavioral parity with `frontend/src/trading/trading.test.ts`.

**Contract**: Cover soft-cap, pyramid/hedge nets, FIFO/close-all/close-by-id, PnL signs, limit/stop touch fills, soft-cap cancel on open fill, cancel-by-id, account balance.

### Success Criteria:

#### Automated Verification:

- `dotnet test --filter PaperTradingEngine` (or full `dotnet test`) passes with parity cases green
- Engine project builds with no new analyzer errors in changed files

#### Manual Verification:

- None (library-only phase)

**Implementation Note**: After automated verification passes, proceed to Phase 2 (no UI manual gate).

---

## Phase 2: Session commands + authoritative store

### Overview

Extend session API/service so the server creates sessions on Start and applies engine mutations on advance/trade/order commands, persisting after each success.

### Changes Required:

#### 1. Start + command endpoints

**File**: `backend/TradingTutor.API/Controllers/SessionsController.cs`

**Intent**: Expose Start and mutation commands; stop accepting client-built lots/PnL as create authority.

**Contract**:

| Method | Route | Behavior |
|--------|-------|----------|
| `POST` | `/api/sessions` | Start: symbol, exchange, interval, rangeStart/End, sessionStartDate, startingBalance, initial playhead. Server assigns `id`; empty lots/orders/trades; `realizedPnl=0`. |
| `GET` | `/api/sessions`, `/api/sessions/{id}` | Unchanged list/get |
| `POST` | `/api/sessions/{id}/advance` | Body `{ toPlayhead: int }`; load candles; match limits for new bars; set playhead; persist; return full session |
| `POST` | `/api/sessions/{id}/open` | side + qty or percent; server mark from candle at playhead; soft-cap; persist |
| `POST` | `/api/sessions/{id}/close` | mode: fifo / lotId / qty / all |
| `POST` | `/api/sessions/{id}/orders` | place limit/stop |
| `POST` | `/api/sessions/{id}/orders/{orderId}/cancel` | cancel |
| `POST` | `/api/sessions/{id}/lock` | set `sessionLocked` |

Return full `TradingSession` on success; 404 missing; 400 validation/soft-cap/bad playhead.

#### 2. Session command orchestration

**File**: `backend/TradingTutor.Trading/Services/SessionService.cs` (extend or add collaborator service)

**Intent**: Load session, resolve OHLC via `ICandleLoadService` / packs, call `PaperTradingEngine`, persist via `ISessionRepository`, serialize concurrent commands per session id.

**Contract**: Mark and fills use server candles for the session’s exchange/symbol/interval/range — never client-supplied OHLC for money math.

#### 3. Command API tests

**File**: `tests/TradingTutor.Tests/` (e.g. `SessionCommandServiceTests.cs`)

**Intent**: Prove start/open/close/advance/soft-cap without the UI.

**Contract**: Fixture candles; assert persisted lots/PnL/playhead; soft-cap returns failure path.

### Success Criteria:

#### Automated Verification:

- New session command tests pass under `dotnet test`
- Existing `SessionServiceTests` / repository tests updated if Start contract changes, and still pass

#### Manual Verification:

- Create session via OpenAPI/curl; open + advance; confirm `data/sessions/{id}.json` updates

**Implementation Note**: Pause for manual API smoke check before Phase 3.

---

## Phase 3: Frontend thin client

### Overview

Rewire the React session layer to Start + commands; remove local engine mutations as source of truth.

### Changes Required:

#### 1. API client

**File**: `frontend/src/services/api.ts`

**Intent**: Call Start and command endpoints; map full session DTO including future coach fields.

**Contract**: Helpers for start, advance, open, close, place/cancel order, lock; `createSession` body is metadata-only (no lots/PnL authority).

#### 2. SessionContext orchestration

**File**: `frontend/src/session/SessionContext.tsx`

**Intent**: Hold UI/playback UX state; apply server session payloads after every command; queue one in-flight advance.

**Contract**: Play timer computes next playhead then `advance`; open/close/orders call API; drop authoritative `buildSnapshot` Save; review mode still `getSession` + candle fetch by range.

#### 3. Shrink FE trading module

**File**: `frontend/src/trading/trading.ts` (and tests)

**Intent**: Remove authority for money mutations; keep only display helpers if still needed (e.g. unrealized preview).

**Contract**: No `matchLimits` / open/close path used by SessionContext; update or delete obsolete Vitest cases accordingly.

### Success Criteria:

#### Automated Verification:

- Frontend unit tests for remaining helpers pass (`npm test` / vitest in `frontend`)
- `npm run build` or typecheck succeeds for changed TS

#### Manual Verification:

- Start → Play → Long/Short → close → refresh → same positions
- Interval switch still loads candles for the chart; advances remain server-side

**Implementation Note**: Pause for manual sim path confirmation before Phase 4.

---

## Phase 4: Coach by sessionId + persist result

### Overview

Analyze from stored session trades only; persist coach output on the session for review.

### Changes Required:

#### 1. Session coach fields

**File**: `backend/TradingTutor.Core/Models/TradingSession.cs`

**Intent**: Durably store last analysis with the journal.

**Contract**: Fields such as `CoachVerdict`, `CoachAnalysis`, findings collection, `CoachAnalyzedAt` (defaults for old JSON).

#### 2. Coach API + service

**File**: `backend/TradingTutor.API/Controllers/CoachController.cs`, `backend/TradingTutor.Coaching/CoachAnalyzeService.cs`

**Intent**: Accept `{ sessionId }`, load closed trades from repository, run existing rules+LLM, save results onto session, return response.

**Contract**: Remove trades-body analyze as the supported path (single path only). Min trades still `MinimumClosedTrades = 5`.

#### 3. Diary client

**File**: `frontend/src/components/DiaryPage.tsx`, `frontend/src/coach/*`, `frontend/src/services/api.ts`

**Intent**: Analyze with `activeSessionId`; show stored coach fields on load/review; rely on API 400 detail for gate messaging (M7).

**Contract**: Do not POST client-built trade lists as authority.

### Success Criteria:

#### Automated Verification:

- Coach tests with session fixture pass; analyze works without client trade list
- `dotnet test` coaching/session-related filters green

#### Manual Verification:

- ≥5 closes → Diary Analyze → leave → reopen review → verdict still present

**Implementation Note**: Pause for manual coach persistence check before Phase 5.

---

## Phase 5: Candle range / constant cleanup

### Overview

Make the backend the authority for max-bars clamp; avoid silent FE/BE drift.

### Changes Required:

#### 1. Frontend range helper documentation / clamp role

**File**: `frontend/src/session/candleLoadRange.ts`

**Intent**: Keep UX date defaults; treat server `incomplete` / `message` / clamp as authoritative for load limits.

**Contract**: Do not enforce a second conflicting business max that can diverge from `CandleStorageOptions.MaxBarsPerLoad`; comment or adjust so FE does not pretend to own the hard cap.

### Success Criteria:

#### Automated Verification:

- Existing candle load tests still pass (`dotnet test` candle-related)

#### Manual Verification:

- Oversized range still returns clamped/incomplete messaging consistently from the API

---

## Testing Strategy

### Unit Tests:

- PaperTradingEngine parity with FE trading.test.ts cases
- Session command service: start, open, close, advance, soft-cap
- Coach analyze by sessionId + persistence fields

### Integration Tests:

- Optional controller-level tests if the suite already hosts them; otherwise service+fake repository is enough for this solo app

### Manual Testing Steps:

1. Start a session from the entry UI; confirm a JSON file appears under `data/sessions`
2. Play and open Long/Short; refresh; positions match
3. Place TP/SL; advance until fill; PnL and closed trades match expectation
4. Close ≥5 trades; Analyze in Diary; reopen review; coach text still there
5. Request an oversized candle range; confirm incomplete/clamp message

## Performance Considerations

- Batch advance with absolute `toPlayhead` avoids per-bar HTTP.
- Serialize commands per session to avoid lost updates under play+click races.
- Candle load for advance should reuse packs (local-first) already used by the chart path.

## Migration Notes

- Existing session JSON without coach fields deserializes with defaults; review still works.
- Old clients that POST full trading snapshots break intentionally (solo app); Start DTO only.
- Pure React-only unsaved journals disappear — Start always creates a server row.

## References

- Related research: `context/changes/frontend-to-backend/research.md`
- Engine source: `frontend/src/trading/trading.ts`
- Engine tests: `frontend/src/trading/trading.test.ts`
- Session model: `backend/TradingTutor.Core/Models/TradingSession.cs`
- Session API: `backend/TradingTutor.API/Controllers/SessionsController.cs`
- Prior opposing intent: `context/changes/s-03/plan.md` (FE engine) — reversed here for calc ownership

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: PaperTradingEngine (C#) + parity tests

#### Automated

- [x] 1.1 `dotnet test` PaperTradingEngine parity cases pass
- [x] 1.2 Engine project builds clean for changed files

#### Manual

- [x] 1.3 None (library-only) — mark done when automated gate passes

### Phase 2: Session commands + authoritative store

#### Automated

- [x] 2.1 Session command tests pass under `dotnet test`
- [x] 2.2 Existing session/repository tests updated and pass

#### Manual

- [ ] 2.3 API smoke: start/open/advance updates `data/sessions/{id}.json`

### Phase 3: Frontend thin client

#### Automated

- [x] 3.1 Frontend unit tests for remaining helpers pass
- [x] 3.2 Frontend typecheck/build succeeds for changed TS

#### Manual

- [ ] 3.3 Start → Play → trade → refresh keeps positions
- [ ] 3.4 Interval switch chart load still works with server advances

### Phase 4: Coach by sessionId + persist result

#### Automated

- [x] 4.1 Coach-by-sessionId tests pass
- [x] 4.2 Related `dotnet test` coaching/session filters green

#### Manual

- [ ] 4.3 Analyze persists across leave/reopen review

### Phase 5: Candle range / constant cleanup

#### Automated

- [x] 5.1 Candle load tests still pass

#### Manual

- [ ] 5.2 Oversized range shows consistent clamp/incomplete messaging
