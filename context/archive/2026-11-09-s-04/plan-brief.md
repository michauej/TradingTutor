# Trader’s Diary Session Chart — Plan Brief

> Full plan: `context/changes/s-04/plan.md`

## What & Why

Learners need to open session analysis from Trader’s Diary without a mandatory End Session (FR-008) and see a session chart with buy/sell markers (FR-009). This is the US-01 chart half; AI Verdict stays in S-05.

## Starting Point

S-03 already journals `ClosedTrade` / open `Lot` records in `Dashboard` with bar-aligned timestamps. `TradingChart` is candles-only; there is no router or diary screen. Live chart shows the revealed prefix only.

## Desired End State

After session lock, the learner can open `/diary` anytime, see the revealed session chart with economic buy/sell markers for closed trades and open-lot entries, then return to the sim with state intact — still in-memory, no AI, no End Session.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| Diary entry | Dedicated `/diary` route | Clear analysis screen vs denser Dashboard panel |
| Candle window | Revealed prefix `[sessionStart, playhead)` | Honest review; preserves no-peek |
| Marker mapping | Economic buy/sell | Matches PRD “buy/sell markers” |
| Marker surface | Markers on diary chart only | Sim stays clean while trading |
| Open lots | Include entry markers | Full exposure picture mid-session |
| Gate | Anytime after lock | FR-008; ≥5 reserved for S-05 AI |
| Persistence | In-memory only | Thin slice; save later with S-05 |
| Tests | Pure mapper + Vitest | Matches S-02/S-03; low flake |
| Wiring | react-router-dom + SessionProvider | Real route without wiping journal on navigate |

## Scope

**In scope:** Marker mapper + tests; `TradingChart` markers prop; SessionProvider; `/` + `/diary`; CTA after lock; pause on diary enter; legend; open-lot + closed-trade markers.

**Out of scope:** AI coach; persistence; End Session; ≥5 gate; live-chart markers; unrevealed candles; chart DOM tests; folder rename to `diary-session-chart`.

## Architecture / Approach

Pure `buildTradeMarkers` → optional markers on presentational `TradingChart` (`createSeriesMarkers`). Session/trading state lifts into `SessionProvider` above React Router so `/` (Dashboard) and `/diary` share one in-memory session. Diary passes visible candles + markers; sim passes candles only.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Marker mapper + Vitest | Buy/sell mapping + prefix filter tests | Timestamp second-alignment mismatches |
| 2. TradingChart markers | v5 plugin wired; sim still clean | Plugin lifecycle vs incremental `update` |
| 3. Provider + routes + Diary UI | `/diary` path, CTA, pause, legend | State-lift regressions in Load/Play/trade |

**Prerequisites:** S-03 done (closed trades + lots in session); Node for Vitest/frontend scripts.
**Estimated effort:** ~2–3 sessions across 3 phases (state lift is the heavy part).

## Open Risks & Assumptions

- Change folder `s-04` ≠ roadmap Change ID `diary-session-chart` — roadmap auto-status sync will not flip until ids align.
- Pausing on diary enter is assumed preferable to a moving playhead under review markers.
- Multiple markers on one bar (FIFO/close-all) may overlap visually; acceptable for MVP.

## Success Criteria (Summary)

- Learner can open `/diary` after lock without End Session and see revealed-prefix chart markers
- Economic buy/sell mapping covers closed trades and open-lot entries; sim chart stays marker-free
- Session state survives diary round-trip; refresh still clears in-memory data
