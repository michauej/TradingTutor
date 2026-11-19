# Rebuild Download and Store Candles — Plan Brief

> Full plan: `context/changes/rebuild/plan.md`

## What & Why

Rebuild pre-session candle loading so history can exceed ByBit’s 1000-bar single-request cap and survive beyond React memory. Learners pick a range, Load local-first from JSON packs (or download+save), and can force Refresh from exchange — closing the parked S-02 gap without introducing a DB.

## Starting Point

`GET /api/data/bybit` → `ByBitService` returns ≤1000 spot klines; the UI stores them only in `SessionContext`. File import and multi-page history were deferred in S-01/S-02. Roadmap still lists candle persistence as absent. Crypto Tools v1’s JSON pack repository is the storage inspiration; keep ByBit as the only exchange.

## Desired End State

From the Dashboard, choose symbol/interval/range → Load uses a covering local pack when present, otherwise pages ByBit, merges into `{exchange}/{symbol}_{interval}.json`, and feeds the existing chart/playback/trading path. Refresh re-fetches and merges. Partial downloads save progress and warn; hard failures keep the previous good series.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| Scope | Download + durable local store | Fixes the 1000-bar ceiling and persistence gap without bloating into full FR-001 file import |
| Storage | JSON kline packs on disk | Proven Crypto Tools pattern; avoids early ORM |
| History | User-chosen range + safety max (default 10k bars) | Matches real sim needs; backend already had unused start/end |
| Load UX | Local-first + optional Refresh | Fast reloads with explicit stale-pack escape hatch |
| Mid-failure | Save partial + incomplete flag | Don’t lose multi-page progress |
| Pack updates | Merge by timestamp | Packs grow across refreshes instead of wiping history |
| Success bar | End-to-end UI Load/Refresh | Proves the learner path, not only backend files |
| Explicit cuts | No file import, other exchanges, jobs, or EF | Keeps the change focused |

## Scope

**In scope:** Pack schema/repo, paginated ByBit orchestration, load API with meta (`source`/`incomplete`), Dashboard range + Load/Refresh, lazy multi-TF switch during play (block if uncoverable), tests.

**Out of scope:** CSV/JSON file import, Binance/other exchanges, prefetch-all-on-Load, EF/SQLite, live WS feeds, synthesizing missing lower-TF bars, coach/trading logic changes.

## Architecture / Approach

Dashboard → `GET /api/data/candles` → `CandleLoadService` (local pack hit or paginated `IExchangeService` pages) → `ICandlePackRepository` JSON files under `data/candles/` → response `{ candles, source, incomplete }` → `SessionContext` (Load resets session; TF switch remaps playhead by wall-clock or blocks).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Pack model & file repository | Schema, merge, disk IO, unit tests | Merge/path edge cases |
| 2. Orchestrator & API | Range load, pagination, partial save, HTTP meta | ByBit paging/off-by-one / rate limits |
| 3. Frontend range Load + Refresh | UI + session wiring, incomplete warnings | Breaking Load lock/reset contract |
| 4. Lazy multi-TF switch | Switch TF during play; block short history | Playhead sync / coverage edge cases |

**Prerequisites:** Running API + Vite UI; network to ByBit for live manual checks; write access for `data/candles/`.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- ByBit public spot klines remain reachable without keys; sequential paging is enough without a job queue.
- 10_000-bar default max is acceptable for laptop memory and Load latency.
- One mutable pack per exchange/symbol/interval is enough (no versioned snapshots).

## Success Criteria (Summary)

- Range Load creates/uses a JSON pack and drives the sim chart as today
- Second Load of a covered range is local-first; Refresh hits ByBit and merges
- Incomplete downloads warn without corrupting prior good packs/sessions
