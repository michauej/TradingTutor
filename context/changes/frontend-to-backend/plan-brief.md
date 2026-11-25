# Frontend-to-backend Thin Client — Plan Brief

> Full plan: `context/changes/frontend-to-backend/plan.md`
> Research: `context/changes/frontend-to-backend/research.md`

## What & Why

Move paper-trading calc and live session truth to the ASP.NET backend. The React UI becomes a thin client: Start creates a server session, commands mutate state, coach analyzes by `sessionId`. Goal: most calculation and storing on the backend (trust boundary).

## Starting Point

Candles and coach rules/LLM already run on the backend. Session JSON Save exists but trusts a client-built snapshot. The paper engine (`frontend/src/trading/trading.ts`) and live lots/PnL still live only in React.

## Desired End State

Start → server session id. Play/trade/orders go through command APIs; server applies engine + candle OHLC and persists. Diary Analyze uses `sessionId` only; coach result is stored on the session and survives review reload. Chart/diary visuals stay on the FE as projections of server state.

## Key Decisions Made

| Decision | Choice | Why | Source |
| -------- | ------ | --- | ------ |
| Scope | Full thin client (M1–M5 + M6/M7) | User wants calc+store on BE end-to-end | Plan |
| Session lifecycle | Create on Start | Server owns id/state from first moment | Plan |
| Playback | Client timer + `advance` with absolute `toPlayhead` | Batch fills, no server wall-clock | Research |
| Mark / fills OHLC | Server loads packs | Trust boundary | Plan |
| Snapshot POST | Start metadata only | Stop client lots/PnL as authority | Plan |
| Coach | By `sessionId`; persist on `TradingSession` | Single journal + durable verdict | Research / Plan |
| FE `trading.ts` | Remove as authority | Domain moves to C# | Plan |

## Scope

**In scope:** PaperTradingEngine port + parity tests; session Start + advance/open/close/order/lock commands; FE SessionContext/api thin client; coach-by-sessionId + persist; candle max / gate cleanup.

**Out of scope:** Auth, WebSockets, embed candles in session, diary/chart on backend, ICT APIs, session delete/rename UI.

## Architecture / Approach

```
UI action / play tick → command → PaperTradingEngine + session JSON → full state → UI
Coach → sessionId → load ClosedTrades → rules+LLM → save coach fields on session
Candles → existing load/store (FE view cache only)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Engine + tests | C# parity with `trading.ts` | Port drift vs Vitest |
| 2. Session commands | Start + advance/trade APIs | Candle load + concurrency |
| 3. FE thin client | SessionContext on commands | Play/advance races |
| 4. Coach persist | Analyze by sessionId | LLM + schema defaults |
| 5. Range cleanup | Server max-bars authority | Silent FE/BE drift |

**Prerequisites:** Research complete; backend/frontend runnable locally.
**Estimated effort:** ~2–4 sessions across 5 phases (Phase 1–2 heaviest).

## Open Risks & Assumptions

- Advance latency on large playhead jumps — mitigated by single batch `toPlayhead`.
- In-flight advance vs user trade — serialize per session id.
- Reverses S-02/S-03 “engine on FE” intentional MVP shortcuts.

## Success Criteria (Summary)

- Money/position changes only via API; refresh restores the same session.
- Diary Analyze uses `sessionId`; coach result survives leave/reopen.
- No client-built trading snapshot is accepted as create authority.
