---
date: 2026-11-25T00:21:52+01:00
researcher: Auto
git_commit: c8772027125a21bb810f0c3c729443b55afce298
branch: main
repository: TradingTutor
topic: "Frontend vs backend ownership — calc and storage placement (full app, move-plan inputs)"
tags: [research, codebase, frontend, backend, trading-engine, session-storage, coach, candles, playback]
status: complete
last_updated: 2026-11-25
last_updated_by: Auto
last_updated_note: "Added follow-up research for theoretical FE/BE placement (thin client, trust boundary, commands)"
---

# Research: Frontend vs backend ownership — calc and storage

**Date**: 2026-11-25T00:21:52+01:00
**Researcher**: Auto
**Git Commit**: c8772027125a21bb810f0c3c729443b55afce298
**Branch**: main
**Repository**: TradingTutor

## Research Question

What is done on the frontend and what is done on the backend today? Most calculation and storing should be on the backend. Produce a full-app inventory, misplacement audit, and concrete migration candidates for a later plan.

Scope: full app (session, trading, candles, diary, coach, playback). Depth: move-plan inputs (1C / 2A).

## Summary

**Candles (load + durable packs) and coach analysis (rules + LLM) already live on the backend.** Session Save/Load also persists on the backend as JSON snapshots.

**The paper-trading engine (PnL, fills, soft-cap, lots/orders) and live session state still live only on the frontend** (`SessionContext` + `trading.ts`). The backend stores whatever snapshot the client posts — it does not recompute or validate trading invariants. Coach analyze trusts client-supplied `RealizedPnl`.

**Historical plans deliberately put the sim engine and playback clock on the client** (S-02, S-03, positon-handling). Moving live calc to the backend would reverse those decisions, not continue them. That is still aligned with the user’s stated goal for this change.

Primary migration path: **port trading engine → session trade/advance commands → authoritative session store → coach-by-session-id → optional coach result persistence → candle helper / gate cleanup**.

## Detailed Findings

### Frontend ownership (current)

Routes: `/` entry, `/trade` sim, `/diary` — wrapped by `SessionProvider` ([App.tsx](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/App.tsx)).

**No `localStorage` / `sessionStorage`.** Live truth is React memory until Save.

| Area | What FE owns | Key refs |
|------|--------------|----------|
| Paper trading engine | Soft-cap, PnL, nets, open/close FIFO, limit/stop match, mark | [trading.ts](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/trading/trading.ts) |
| Live session state | lots, orders, closedTrades, realizedPnl, playhead, seriesCache | [SessionContext.tsx](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/session/SessionContext.tsx) (~291–295, 665–914) |
| Snapshot assembly | Client builds full DTO then `POST /api/sessions` | SessionContext `buildSnapshot` / `saveSession` |
| Playback UX | Warm-up, speed delays, advance/at-end; timer fills via `matchLimits` | [playback.ts](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/playback/playback.ts); SessionContext timer |
| Candle range helpers | Date→ISO, `MAX_BARS_PER_LOAD=10000` (must match backend) | [candleLoadRange.ts](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/session/candleLoadRange.ts) |
| Interval switch UX | Playhead remap, coverage gate, in-memory series cache | [intervalSwitch.ts](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/session/intervalSwitch.ts) |
| Diary visuals | Markers, spans, snap-to-candle, filters | `frontend/src/diary/*`, DiaryPage |
| Coach client | Min-5 gate, map trades, POST body, hold result in React | [analyzeGate.ts](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/coach/analyzeGate.ts), DiaryPage |
| Chart | lightweight-charts render of visible prefix | TradingChart.tsx |

API client: [api.ts](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/frontend/src/services/api.ts) — candles, sessions CRUD-lite, coach analyze. `fetchByBitCandles` is defined but unused by UI.

### Backend ownership (current)

| Area | API | Calc | Persist |
|------|-----|------|---------|
| Sessions | `POST/GET /api/sessions`, `GET /{id}` | timestamps only | JSON under `data/sessions` via [JsonSessionRepository](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/backend/TradingTutor.Trading/Storage/JsonSessionRepository.cs) |
| Candles | `GET /api/data/candles`, `GET /api/data/bybit` | merge, clamp, paging | packs under `data/candles/{Exchange}/` |
| Coach | `POST /api/coach/analyze` | 5 rules + LLM parse | none (stateless); lecture files optional |
| Trading engine | **none** | **none** | only as opaque fields inside session JSON |

Session model stores range refs, playhead, balances, lots, orders, closed trades — not embedded candles ([TradingSession.cs](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/backend/TradingTutor.Core/Models/TradingSession.cs)).

Coach pipeline: validate ≥5 trades → FixedRulePack → lecture → LM Studio → parse ([CoachAnalyzeService.cs](https://github.com/michauej/TradingTutor/blob/c8772027125a21bb810f0c3c729443b55afce298/backend/TradingTutor.Coaching/CoachAnalyzeService.cs)). Inputs are client-supplied `ClosedTradeInput` including `RealizedPnl`.

### Already correct on backend

- Candle load orchestration (local-first, exchange page, max bars) — `CandleLoadService` / `DataController`
- Durable candle packs — `JsonCandlePackRepository` / `CandlePackMerger`
- Session file create / get / list — `SessionService` / `SessionsController`
- Coach min-trade gate + field validation + rule math + LLM — `CoachAnalyzeService` / rules
- Exchange ingress — `ByBitService`

### Misplaced on frontend (should move for user’s goal)

| Item | Evidence | Why |
|------|----------|-----|
| Paper trading engine | `trading.ts` 57–531; SessionContext applies it | Authoritative money/position truth |
| Live lots/orders/PnL only in React until Save | SessionContext 291–295 | Unsaved work lost; Save trusts client |
| Client-minted session id + free-form snapshot | SessionContext `newSessionId`, `buildSnapshot` | Server should own id + apply mutations |
| Coach payload from live browser trades | DiaryPage → `mapClosedTradesForCoach` | Prefer load from stored session / recompute PnL |
| Coach result only in component state | DiaryPage coachState | Lost on leave; not part of session |
| Duplicated `MAX_BARS_PER_LOAD` / min-trades | candleLoadRange vs CandleStorage; analyzeGate vs CoachAnalyzeService | Drift risk |

### Should stay on frontend

- Play / pause / speed timer (wall-clock UX)
- Chart slice / warm-up reveal helpers (display)
- Diary filters, markers/spans/snap (chart projection)
- Forms, routing, review-mode UI
- Optional optimistic qty preview if server re-validates
- Ephemeral candle series cache (UX only; packs remain server truth)

### Gaps (API does not own today)

- Trade open/close/fill commands
- Playhead advance that applies fills server-side
- Session delete / rename / patch
- Candle pack admin
- Coach + candles in one request (trades-only today)
- Auth / multi-user
- Structure overlays server API (ICT dual-detect is a separate change)

## Migration candidates (for `/10x-plan`)

Suggested order: **engine → session commands → authoritative save → coach binding → coach persistence → helper cleanup**.

| # | Name | From → to | Rough scope | Risk | Depends on |
|---|------|-----------|-------------|------|------------|
| **M1** | PaperTradingEngine | `frontend/src/trading/trading.ts` → C# service in `TradingTutor.Trading` | Port PnL, soft-cap, open/close FIFO, matchLimits; parity with `trading.test.ts` | High | — |
| **M2** | Session trade + advance commands | SessionContext mutators → e.g. `POST /api/sessions/{id}/…` | Each trade and each playhead step applies M1; returns new state | High (latency / playback design) | M1 |
| **M3** | Authoritative session store | Client `buildSnapshot` → server-owned state after commands | Validate invariants; stop blind overwrite of unverified PnL/lots | Medium–high | M1–M2 |
| **M4** | Coach analyze by session id | POST client trades → analyze by `sessionId` (server loads trades; optional PnL recompute) | API + Diary call site | Medium | M3 preferred |
| **M5** | Persist coach results | Diary React state → session fields or side file | Findings/verdict/analysis + timestamp | Low–medium | M4 |
| **M6** | Candle range contract | Duplicate max/align → backend authority / shared contract | Thin; FE keeps date inputs | Low | Independent |
| **M7** | Analyze gate single source | Duplicate min-trades → API error / metadata | Tiny | Low | Can ship with M4 |

**Playback note:** Keep timer/speed on the client. Move **fill matching on advance** into M2 so calc is not split across tiers.

## Code References

- `frontend/src/trading/trading.ts` — full paper engine (calc that should move)
- `frontend/src/session/SessionContext.tsx` — live state, play tick fills, save snapshot
- `frontend/src/services/api.ts` — FE↔BE contract
- `frontend/src/playback/playback.ts` — client session clock (keep UX)
- `frontend/src/diary/*` — chart projections (keep)
- `frontend/src/coach/analyzeGate.ts` / `mapClosedTradesForCoach.ts` — client coach glue
- `backend/TradingTutor.API/Controllers/SessionsController.cs` — snapshot CRUD-lite
- `backend/TradingTutor.API/Controllers/DataController.cs` — candle load
- `backend/TradingTutor.API/Controllers/CoachController.cs` — analyze
- `backend/TradingTutor.Trading/Services/SessionService.cs` — persist only, no trade calc
- `backend/TradingTutor.Trading/Services/CandleLoadService.cs` — candle orchestration
- `backend/TradingTutor.Coaching/CoachAnalyzeService.cs` — rules + LLM
- `backend/TradingTutor.Core/Models/TradingSession.cs` — snapshot shape

## Architecture Insights

1. **Two-tier truth today:** React for live sim; JSON files for durable candles + session snapshots + coach compute. Snapshot Save is an export of client truth, not an apply of server commands.
2. **Trust boundary:** Coach rules and session storage consume client PnL/lots without recomputation — fine for solo MVP, weak if “backend owns calc.”
3. **Deliberate history vs new goal:** S-02/S-03 kept engine/clock on FE for speed. Candle packs (rebuild) and session snapshots (positon-handling) already moved storage server-side. This change would continue storage centralization into **live calc**.
4. **Playback design is the hard part of M2:** advancing many bars via per-tick HTTP may need batch advance, websocket, or “advance N bars” RPC.

## Historical Context (from prior changes)

### Supports backend storage / coach calc
- Candle packs on backend — `context/archive/2026-11-18-rebuild/plan.md`
- Session snapshots on backend — `context/changes/positon-handling/plan.md` (live lots/PnL still React until Save)
- Coach rules + LLM on ASP.NET — `context/changes/s-05/plan.md`
- ICT: server re-detect for authoritative findings — `context/changes/ict-develop/plan.md`

### Contradicts moving live sim calc (prior intent)
- Client session clock; no backend playback APIs — `context/archive/2026-11-08-playback-controls/plan.md`
- Paper engine on frontend; backend trade APIs out of scope — `context/changes/s-03/plan.md`
- S-04 in-memory only — `context/archive/2026-11-09-s-04/plan.md`
- Early S-01: candles held in React — superseded for packs by rebuild

**Net:** Docs already put **storage** (candles, session files) and **coach calc** on the backend. They do **not** put the **live paper-trading / playback engine** there. `frontend-to-backend` is the place to reverse that for calc.

## Related Research

- No prior `research.md` in this change folder (first artifact).
- Related plans: `context/changes/s-03/`, `context/changes/s-05/`, `context/changes/positon-handling/`, `context/archive/2026-11-18-rebuild/`.

## Open Questions

1. Should M2 use per-tick commands, batch “advance to playhead,” or keep fills client-side temporarily while only open/close go server-side?
2. Must coach analyze require a saved session, or is live-unsaved analyze still allowed during migration?
3. Should coach results become part of `TradingSession` JSON or a separate artifact?
4. Is reversing S-03 in scope for one plan, or should M1 (engine port + tests) land before API surface work?

## Follow-up Research 2026-11-25T00:24:10+01:00

### Question

How should frontend vs backend placement be done according to theory (given the goal: most calculation and storing on the backend)?

### Theoretical model (thin client + trust boundary)

Classic layered / client–server practice for a sim + journal + coach app:

| Layer | Owns | Does not own |
|-------|------|--------------|
| **Presentation (React)** | Render, input, navigation, local UX timers, optimistic preview | Authoritative money/position math; durable writes as free-form blobs |
| **Application / API (ASP.NET)** | Commands, queries, auth later, orchestration | Chart pixels, button chrome |
| **Domain (Trading / Coaching)** | Rules: open/close/fill, PnL, soft-cap, coach rules | UI layout |
| **Infrastructure** | JSON packs/sessions, exchange HTTP, LM Studio | Business decisions |

**Single source of truth:** Durable session state and all invariants that affect balance, lots, orders, closed trades, and coach inputs live on the server.

**Trust boundary:** The browser is untrusted for money truth. The client sends *intents* (commands), not *results* (precomputed PnL snapshots as authority).

**Command / query split (practical CQRS-lite):**
- **Commands** mutate session: create session, open/close, place/cancel order, advance playhead (N bars), request analyze.
- **Queries** read: candles by range, session snapshot, session list, last coach result.

**What theory still allows on the client:**
- Display projections (markers, spans, filters) from server state.
- Playback *clock* as UX (request “advance”) — server applies fills for those bars.
- Optimistic UI only if the next server response can correct it.

### Target flow (theory applied to TradingTutor)

```
User action / play tick
  → FE sends command (trade | advance | analyze)
  → Domain engine on backend applies rules, updates session store
  → FE receives new state (or delta) and re-renders
Coach
  → FE sends sessionId (not a client-built trade list as authority)
  → Backend loads closed trades from store (optionally recomputes PnL)
  → Rules + LLM → persist result on session (or side artifact)
Candles
  → Already correct: load/store on backend; FE holds ephemeral view cache only
```

### Mapping to migration candidates

| Theory rule | Migration |
|-------------|-----------|
| Domain owns trading math | M1 PaperTradingEngine on backend |
| Mutations via commands, not client snapshots as truth | M2 trade/advance APIs; M3 authoritative store |
| Coach reads server journal | M4 analyze by sessionId |
| Analysis is durable output of domain | M5 persist coach results |
| Shared limits as server contract | M6–M7 |

### Theory answer to open question 1 (playback)

Prefer **batch advance** (`advance to index` / `advance N bars`) over per-tick HTTP: one command, server runs `matchLimits` for each new bar, returns state. Client keeps setInterval only to *decide when* to call advance. That keeps calc on the server without a server wall-clock.

### Deviation from prior product plans

S-02/S-03 chose a thick client for speed. Theory for “calc + store on backend” prefers the thin-client command model above; treat S-02/S-03 as temporary MVP shortcuts to reverse in this change.
