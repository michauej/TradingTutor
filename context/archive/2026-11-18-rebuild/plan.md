# Rebuild Download and Store Candles Implementation Plan

## Overview

Rebuild pre-session candle loading so TradingTutor can paginate ByBit history beyond the 1000-bar cap, persist series as JSON packs on disk, and Load local-first (with optional force-refresh) while preserving the existing sim session contract.

## Current State Analysis

Today `GET /api/data/bybit` → `ByBitService.GetMarketDataAsync` issues a **single** ByBit `/v5/market/kline` request (limit clamped 1–1000). The frontend `fetchByBitCandles` never sends `startTime`/`endTime` and keeps the result only in `SessionContext` React state. Roadmap still records candle persistence as absent; S-01/S-02 parked file ingest and multi-page history. Crypto Tools v1’s useful pattern is a JSON `KlinePack` file repository; Crypto Tools 2.0 matches the current ByBit-on-demand shape and left EF unused.

Session rules that must stay intact: Load while unlocked resets playback + trading via `resetSessionFromCandles`; failed Load must not wipe a good series; after first Play the Load form stays locked.

## Desired End State

Learner picks symbol, interval, and a time range (or “last N days”), clicks Load: if a covering local pack exists it is used; otherwise the API pages ByBit, merges into a JSON pack, and returns the series. Refresh from exchange always re-fetches the requested range, merges into the pack, and reloads the session series. Mid-download failures persist what was fetched, flag the pack incomplete, and surface a clear message. Playback/trading/chart behave as today on the loaded series.

After Load, the learner can switch chart interval during play (top-down workflow): only the active interval is downloaded on Load; other intervals are fetched lazily on switch using the same symbol/range. Switch keeps wall-clock time. If the target interval has no bar covering the current play time (lower TFs often have shorter exchange history), the switch is **blocked** with a clear reason — playhead and series stay unchanged. No file CSV import, no other exchanges, no background jobs, no EF/DB.

### Key Discoveries:

- Single-page client stays at `backend/TradingTutor.Trading/Services/ByBitService.cs` (`GetMarketDataAsync`, limit clamp 1–1000) — pagination belongs in a new orchestrator, not inside ByBit
- HTTP entry today: `backend/TradingTutor.API/Controllers/DataController.cs` `GET api/data/bybit`
- Frontend load: `frontend/src/session/SessionContext.tsx` `handleLoad` → `frontend/src/services/api.ts` `fetchByBitCandles`
- Domain candle shape already shared: `backend/TradingTutor.Core/Models/MarketData.cs`
- Tests pattern: xUnit + stubbed `HttpMessageHandler` in `tests/TradingTutor.Tests/ByBitServiceTests.cs`; frontend Vitest for pure helpers
- Stack constraint: `has_background_jobs: false` in `context/foundation/tech-stack.md` — sync Load only

## What We're NOT Doing

- File CSV/JSON upload import (FR-001 file path remains deferred)
- Additional exchanges (Binance, etc.)
- Background prefetch / catalog sync jobs
- EF/SQLite/ORM for candles
- Live WebSocket klines / in-session exchange streaming
- Changing trading, diary, or coach behavior beyond consuming the loaded series
- Prefetching all intervals on every Load (lazy-on-switch only; optional prefetch may come later)
- Multi-symbol packs in one Load
- Inventing / synthesizing lower-TF bars the exchange never returned
- Clamping playhead forward when a TF lacks history (block + explain instead)

## Implementation Approach

Keep `IExchangeService` as the single-page ByBit adapter. Add a pack DTO + file repository (Crypto Tools–style JSON packs) and a `CandleLoadService` orchestrator that: validates range → optionally reads local pack → pages exchange when needed or when `refresh=true` → merges by timestamp → writes pack (including incomplete) → returns candles + meta. Expose this via a dedicated load endpoint; wire Dashboard range + Load/Refresh to it. Prefer local pack when it already covers the requested range; otherwise download the missing span (or full range on refresh), merge, and save.

Default safety max: **10_000 bars** per Load (configurable in `appsettings`), enough for multi-day 1m or long higher-TF sessions without unbounded memory. Pack files live under a configurable root (default `data/candles/`) as `{exchange}/{symbol}_{interval}.json`.

Frontend keeps a per-interval series cache for the current symbol/range. Initial Load fills the selected interval; switching chart interval reuses a cached pack or calls the same candles API lazily, then remaps playhead by wall-clock time — or refuses the switch when coverage is missing.

## Critical Implementation Details

### Timing & lifecycle

ByBit returns newest-first per page; each page must be normalized oldest-first before merge. Paginate **backward** from `end` (or now) toward `start` using the oldest timestamp of the previous page as the next `end`, stopping when `start` is covered, a page returns fewer than the page size, or the safety max is hit. Do not write the pack until the successful pages for this attempt are merged with any existing pack (on total failure with zero new bars, leave the prior pack untouched).

### State sequencing

API response must distinguish `source` (`local` | `exchange` | `partial`) and `incomplete` so the UI can warn without treating a partial series as a hard failure that clears the previous good session. Only call `resetSessionFromCandles` after a successful response with at least one candle.

## Phase 1: Pack model and file repository

### Overview

Introduce the durable pack schema, disk repository (read/write/merge), and unit tests — no HTTP or ByBit pagination yet.

### Changes Required:

#### 1. Pack DTO

**File**: `backend/TradingTutor.Core/Models/` (e.g. `CandlePack.cs`)

**Intent**: Define a serializable pack that holds series metadata plus OHLCV candles so disk and API can share one shape.

**Contract**: Pack includes at least `Symbol`, `Exchange`, `Interval`, `Incomplete` (bool), optional `RequestedStart`/`RequestedEnd`, `UpdatedAt`, and ordered `Candles` (`List<MarketData>` or equivalent). Filename key is exchange + symbol + interval (one mutable pack per key).

#### 2. Pack repository port + JSON file implementation

**File**: `backend/TradingTutor.Trading/Interfaces/` + `backend/TradingTutor.Trading/Storage/` (or `Repositories/`)

**Intent**: Isolate filesystem details behind a port so load orchestration and tests can fake storage.

**Contract**: `ICandlePackRepository` supports get-by-key, save (overwrite whole pack JSON), and a pure merge helper (or service method) that unions candles by `Timestamp` (later/equal bar wins on collision), sorts ascending, and preserves/updates metadata. Root directory from options (default `data/candles`). Path layout: `{root}/{exchange}/{symbol}_{interval}.json`.

#### 3. Options + DI registration stub

**File**: `backend/TradingTutor.API/appsettings.json`, `Program.cs`, options class under Trading

**Intent**: Make pack root and safety max configurable without hardcoding paths in the repository.

**Contract**: Config section (e.g. `CandleStorage`) with `RootPath` and `MaxBarsPerLoad` (default 10000). Register repository as singleton or scoped consistent with file IO; options via `IOptions`.

#### 4. Unit tests for merge and repository

**File**: `tests/TradingTutor.Tests/`

**Intent**: Lock merge/dedupe/sort and round-trip JSON write/read (temp directory).

**Contract**: Cover empty+new, overlapping ranges, duplicate timestamps, incomplete flag round-trip. No live ByBit.

### Success Criteria:

#### Automated Verification:

- `dotnet test` passes including new pack merge/repository tests
- Pack JSON round-trips through the repository against a temp directory

#### Manual Verification:

- Inspect a written sample pack file on disk and confirm readable JSON with expected fields

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Paginated load orchestrator and API

### Overview

Add range-aware load orchestration (local-first, refresh, pagination, partial save) and an HTTP contract the frontend can call.

### Changes Required:

#### 1. Candle load orchestrator

**File**: `backend/TradingTutor.Trading/Services/` (e.g. `CandleLoadService.cs`) + interface

**Intent**: Own “resolve candles for symbol/interval/range” so controllers stay thin and `ByBitService` remains single-page.

**Contract**: Input: symbol, interval, start, end, `refresh` bool, cancellation. Behavior: validate `start < end` and clamp projected bar count to `MaxBarsPerLoad`; if `!refresh` and local pack covers the range, return local candles + `source=local`, `incomplete` from pack; else page `IExchangeService.GetMarketDataAsync` (page size ≤1000) over the needed span; on success merge into existing pack, clear or set `Incomplete`, save, return; on mid-flight failure after ≥1 page, merge/save with `Incomplete=true`, return partial + `source=partial` (or throw a typed result the controller maps); on failure with 0 new bars and no usable local cover, fail without corrupting prior pack. Do not introduce background jobs.

#### 2. Load API endpoint

**File**: `backend/TradingTutor.API/Controllers/DataController.cs` (or dedicated controller)

**Intent**: Expose the orchestrated load path for the UI without breaking the existing single-page ByBit helper if still useful for debugging.

**Contract**: e.g. `GET /api/data/candles?symbol&interval&startTime&endTime&refresh` returning a response DTO `{ candles, source, incomplete, message? }` (camelCase JSON). Map validation → 400; exchange hard failure with no data → 502; partial success → 200 with `incomplete=true` and a clear `message`. Keep `GET /api/data/bybit` as thin single-page passthrough or document it as debug-only — orchestrated Load must not depend on the frontend calling it directly.

#### 3. Orchestrator tests with stubbed exchange + fake/temp repository

**File**: `tests/TradingTutor.Tests/`

**Intent**: Prove local-hit, refresh-forces-fetch, multi-page assembly, safety-max stop, and partial-save-on-failure without live network.

**Contract**: Stub `IExchangeService` to return scripted pages; assert call counts, merge results, `Incomplete` flag, and that prior pack is unchanged when zero bars are fetched on failure.

### Success Criteria:

#### Automated Verification:

- `dotnet test` passes including orchestrator tests (local hit, refresh, pagination, partial failure, max bars)
- Manual HTTP sample (`.http` or curl) can load a small range against live ByBit in dev and write a pack under `data/candles/`

#### Manual Verification:

- Confirm pack file appears/updates on disk after a live orchestrated load
- Confirm a second load of the same covered range does not require exchange calls (log or debugger) when `refresh=false`
- Confirm `refresh=true` hits ByBit and updates `UpdatedAt`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend range Load and Refresh

### Overview

Wire Dashboard + session load to the new API: range selection, local-first Load, Refresh from exchange, incomplete warning — without breaking session lock/reset rules.

### Changes Required:

#### 1. API client

**File**: `frontend/src/services/api.ts`

**Intent**: Replace the Load path’s single-page ByBit call with the orchestrated candles endpoint.

**Contract**: New `fetchCandles({ symbol, interval, startTime, endTime, refresh?, signal })` returning `{ candles, source, incomplete, message? }`. Keep or thin-wrap legacy `fetchByBitCandles` only if something else still needs it; session Load must use `fetchCandles`.

#### 2. Session load + refresh handlers

**File**: `frontend/src/session/SessionContext.tsx`

**Intent**: Drive Load/Refresh through the new client while preserving lock, abort, and “failed load keeps prior series” behavior.

**Contract**: Extend state with download range fields (defaults sensible, e.g. last 7 days ending now, aligned to interval). `handleLoad` uses `refresh=false`; `handleRefresh` (unlocked only) uses `refresh=true`. On success with candles → `resetSessionFromCandles` as today. On incomplete success → still load series but set a non-fatal warning from `message`/`incomplete`. On hard error → set error, do not clear good candles. Session lock after Play still disables Load/Refresh.

#### 3. Dashboard form UX

**File**: `frontend/src/components/Dashboard.tsx` (+ CSS if needed)

**Intent**: Let the learner choose the history window and force a refresh without a separate datasets screen.

**Contract**: Add start/end (or “last N days” control that sets the range) next to symbol/interval; Load button; Refresh from exchange control; show incomplete/source warning near the existing load status line. Remove or retire the “until file ingest” copy that implies only live fetch exists if it would contradict local packs. Do not add a full dataset manager UI.

#### 4. Frontend tests for mapping helpers if extracted

**File**: `frontend/src/` pure helpers + Vitest

**Intent**: Cover range defaulting / incomplete warning mapping without mounting the full Dashboard.

**Contract**: If helpers are extracted (recommended for defaults and response→warning text), add Vitest cases; otherwise rely on manual E2E for this phase.

### Success Criteria:

#### Automated Verification:

- `dotnet test` passes
- `npm test` passes (including any new Vitest helpers)
- `npm run build` succeeds

#### Manual Verification:

- Choose a multi-day range on 1h (or 1m small enough under max), Load → chart/playback work; pack file exists
- Reload same range → fast local path; status indicates local/cached source if shown
- Refresh from exchange → network fetch; series updates; pack `UpdatedAt` changes
- Simulate/force incomplete (e.g. cancel mid-load or use a range that hits a stubbed failure in API tests already covered) → warning visible; prior good session not wiped on hard failure
- Session lock: after Play, Load/Refresh disabled; unlocked Load still resets trading + playback together

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Lazy multi-timeframe switch during play

### Overview

Let the learner change chart interval after Load (including while playing): download other intervals on demand for the same symbol/range, remap playhead by wall-clock time, and block the switch with a clear message when lower-TF history does not cover the current play time.

### Changes Required:

#### 1. Interval-switch helpers

**File**: `frontend/src/session/` (pure helpers + Vitest)

**Intent**: Keep cover checks and playhead remapping testable without mounting Dashboard.

**Contract**: Helpers for (a) current wall-clock time from exclusive playhead, (b) whether a series covers that time, (c) new playhead index for a target series at that time (preserving session-start date), (d) human-readable block reasons including shorter lower-TF history.

#### 2. Session cache + switchInterval

**File**: `frontend/src/session/SessionContext.tsx`

**Intent**: Own lazy TF switching without resetting trading on a successful switch.

**Contract**: Remember the Load range (`startTime`/`endTime`) and a `Record<interval, candles>` cache for the current symbol. Initial Load/Refresh populate the active interval and clear other cached intervals when symbol/range changes. `switchInterval(next)` (allowed while locked/playing): if cached and covering → swap series + remap playhead; else `fetchCandles` for same range; on success with coverage → cache + swap; on missing coverage or hard error → keep current series/playhead and set a non-fatal warning/error explaining why (2A). Do not call `resetSessionFromCandles` / wipe trades on TF switch. Pause playback only while a lazy fetch is in flight if needed to avoid racing the playhead.

#### 3. Dashboard chart-interval UX

**File**: `frontend/src/components/Dashboard.tsx` (+ CSS if needed)

**Intent**: Expose TF switching for the top-down workflow and educate about history limits.

**Contract**: Chart interval control remains usable after Play (unlike Load/Refresh). Short static hint that lower timeframes often have shorter available history. Surface the block/warning message when a switch is refused. Load-form interval still chooses the first downloaded TF when unlocked.

### Success Criteria:

#### Automated Verification:

- `dotnet test` passes
- `npm test` passes including interval-switch helper tests
- `npm run build` succeeds

#### Manual Verification:

- Load 1h → Play → switch to 5m/1m when history covers current time → chart updates, playhead time preserved, trades remain
- Switch to a lower TF that does not cover current play time → blocked with clear message; series unchanged
- Lazy switch triggers a download (status/network) the first time; second switch back uses cache
- Load/Refresh still locked after Play; chart interval switch still available

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Pack merge/dedupe/sort and JSON repository round-trip (temp dir)
- Orchestrator: local cover hit, refresh bypass, multi-page stitch, max-bars clamp, partial save, prior pack preserved on total failure
- Existing `ByBitServiceTests` remain green (single-page adapter unchanged in responsibility)
- Frontend: playhead↔timestamp remap, cover check, block-message formatting for short lower-TF history

### Integration Tests:

- Optional `.http` live samples for orchestrated endpoint (manual/dev); no `WebApplicationFactory` required unless already introduced elsewhere

### Manual Testing Steps:

1. Cold Load of BTCUSDT 1h for last 7 days → candlesticks + pack on disk
2. Second Load same params → local hit, no unnecessary ByBit traffic
3. Refresh → ByBit called, pack updated
4. Start playback/trading on loaded series → same behavior as before this change
5. Hard failure path (stop API / bad symbol) → error shown, previous good chart kept
6. Confirm `data/candles/` (or configured root) is gitignored if it isn’t already
7. During play, switch to a covered lower TF → series changes, wall time preserved
8. During play, attempt a TF with insufficient history → blocked + explanation

## Performance Considerations

Pagination is sequential with a hard `MaxBarsPerLoad` (default 10_000) to bound memory and request count. Prefer local pack when it covers the range to avoid ByBit on every session start. Do not load packs into coach/LLM prompts.

## Migration Notes

No DB migration. Existing users only have in-memory candles — first Load after this change creates packs. Optionally gitignore `data/candles/` (or configured root). Old `GET /api/data/bybit` may remain for debug; the UI Load path must not depend on it.

## References

- Prior slice: `context/archive/2026-11-07-load-candles-chart/`
- Playback cap context: `context/archive/2026-11-08-playback-controls/`
- PRD FR-001: `context/foundation/prd.md`
- Inspiration: `Crypto_Tools_REPO_MAP.md` (JSON kline packs), `Crypto_Tools_2_0_REPO_MAP.md` (ByBit + MarketData)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pack model and file repository

#### Automated

- [x] 1.1 `dotnet test` passes including new pack merge/repository tests
- [x] 1.2 Pack JSON round-trips through the repository against a temp directory

#### Manual

- [ ] 1.3 Inspect a written sample pack file on disk and confirm readable JSON with expected fields

### Phase 2: Paginated load orchestrator and API

#### Automated

- [x] 2.1 `dotnet test` passes including orchestrator tests (local hit, refresh, pagination, partial failure, max bars)
- [ ] 2.2 Manual HTTP sample can load a small range against live ByBit in dev and write a pack under `data/candles/`

#### Manual

- [ ] 2.3 Confirm pack file appears/updates on disk after a live orchestrated load
- [ ] 2.4 Confirm a second load of the same covered range does not require exchange calls when `refresh=false`
- [ ] 2.5 Confirm `refresh=true` hits ByBit and updates `UpdatedAt`

### Phase 3: Frontend range Load and Refresh

#### Automated

- [x] 3.1 `dotnet test` passes
- [x] 3.2 `npm test` passes (including any new Vitest helpers)
- [x] 3.3 `npm run build` succeeds

#### Manual

- [ ] 3.4 Choose a multi-day range, Load → chart/playback work; pack file exists
- [ ] 3.5 Reload same range → fast local path; status indicates local/cached source if shown
- [ ] 3.6 Refresh from exchange → network fetch; series updates; pack `UpdatedAt` changes
- [ ] 3.7 Incomplete/hard-failure UX: warning on incomplete; prior good session kept on hard failure
- [ ] 3.8 Session lock: after Play, Load/Refresh disabled; unlocked Load resets trading + playback together

### Phase 4: Lazy multi-timeframe switch during play

#### Automated

- [x] 4.1 `dotnet test` passes
- [x] 4.2 `npm test` passes including interval-switch helper tests
- [x] 4.3 `npm run build` succeeds

#### Manual

- [ ] 4.4 Load higher TF → Play → switch to covered lower TF; wall time preserved; trades kept
- [ ] 4.5 Switch to TF without history at play time → blocked with clear message
- [ ] 4.6 First switch downloads; switching back uses cache
- [ ] 4.7 After Play, Load/Refresh locked but chart interval switch still available
