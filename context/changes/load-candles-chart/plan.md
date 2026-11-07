# Load Candles Chart Implementation Plan

## Overview

Implement roadmap S-01 (`load-candles-chart` / FR-001): the learner can download historical ByBit spot candles before a session and see them as candlesticks on a sim chart. This slice also stands up the React/Vite companion UI and replaces the weatherforecast API sample with a CryptoTools-shaped candle fetch path.

## Current State Analysis

- ASP.NET Core Web API (`net10.0`) at repo root with OpenAPI and a template `GET /weatherforecast` only (`Program.cs`).
- Launch URLs: `https://localhost:7126` and `http://localhost:5014` (`Properties/launchSettings.json`).
- No frontend, no candle models, no exchange client, no CORS.
- Inspiration: `Crypto_Tools_2_0_REPO_MAP.md` — `MarketData` OHLCV, `GET /api/data/bybit`, ByBit `/v5/market/kline`, React + `lightweight-charts` v5, Vite proxy `/api`.

### Key Discoveries:

- CryptoTools returns candles in the HTTP response and holds them in React state; EF persistence is unused — match that for S-01.
- File import is allowed by FR-001 but deferred; S-01 is ByBit download only (speed).
- Public spot klines need no API keys for the CryptoTools working path.

## Desired End State

With API and `frontend/` running locally, the learner sets symbol + interval (defaults e.g. BTCUSDT / 1h), loads candles from ByBit via the API, and sees a candlestick chart. On fetch failure, a clear error is shown and any previously loaded series stays on the chart. An API smoke test covers the ByBit endpoint happy path (or a testable seam).

## What We're NOT Doing

- File / CSV / JSON candle import (later slice if needed)
- Play / Pause / speed (S-02)
- Long / Short / close / balance (S-03)
- Diary markers / AI coach (S-04 / S-05)
- Multi-symbol picker grid (FR-011 parked)
- SQL / EF persistence
- ByBit API keys / user-secrets for market data
- Checked-in sample candle fallback when ByBit is down
- Moving API under `backend/` or multi-project solution split
- Strategy / backtest UI from CryptoTools
- Auth

## Implementation Approach

Mirror CryptoTools’ vertical slice narrowly: domain candle shape + ByBit client behind an exchange interface + one data endpoint + CORS; scaffold `frontend/` with Vite proxy; load controls hold series in React state; paint with `lightweight-charts`; keep error UX non-destructive. Prefer patterns from the repo map over copying unfinished stubs.

## Phase 1: API candle fetch

### Overview

Introduce candle domain types, a ByBit public kline client, `GET /api/data/bybit`, CORS for the Vite origin, and remove the weatherforecast sample so the API surface matches the sim data path.

### Changes Required:

#### 1. Candle domain model

**File**: `Models/MarketData.cs` (or equivalent under a small `Models/` folder at repo root)

**Intent**: Define the OHLCV candle shape used by API responses and later slices, aligned with CryptoTools `MarketData` fields.

**Contract**: Candle (or `MarketData`) includes Symbol, Exchange, Open, High, Low, Close, Volume, Timestamp, Interval. Query params for the fetch endpoint: symbol, interval, optional startTime, endTime, limit.

#### 2. Exchange abstraction + ByBit client

**File**: `Services/IExchangeService.cs`, `Services/ByBitService.cs` (names may match CryptoTools)

**Intent**: Isolate ByBit HTTP details so the controller stays thin and a future exchange can swap in without UI changes.

**Contract**: `GetMarketDataAsync(...)` returns a list of candles from ByBit spot `/v5/market/kline` (category spot, interval conversion as in CryptoTools). Register `HttpClient` + implementation in DI. Public market access only — no API keys.

#### 3. Data endpoint + host wiring

**File**: `Program.cs` (and controller or Minimal API map under `/api/data/bybit`)

**Intent**: Expose candle fetch to the companion UI; enable CORS for the Vite dev origin; drop the weatherforecast sample.

**Contract**: `GET /api/data/bybit` with the query params above; JSON array/list of candles. CORS allows `http://localhost:5173` (and credentials not required). OpenAPI remains available in Development. Prefer controller or Minimal APIs consistent with keeping the host small — either is fine if the route and payload match.

### Success Criteria:

#### Automated Verification:

- Solution builds: `dotnet build`
- API smoke test for ByBit fetch path passes (see Phase 3 if the test project is introduced there; otherwise a Phase 1 unit/integration test against a fake `HttpMessageHandler` for ByBit JSON is acceptable if added here)
- `dotnet test` passes if any test project exists after this phase

#### Manual Verification:

- Calling `GET /api/data/bybit?symbol=BTCUSDT&interval=1h&limit=50` (via `.http` file or browser/OpenAPI) returns non-empty OHLCV JSON while online
- Weatherforecast route is gone or no longer the primary demo surface

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Frontend shell + load controls

### Overview

Scaffold `frontend/` (React 19 + TypeScript + Vite), proxy `/api` to the ASP.NET HTTPS port, and build the load form that fetches candles into React state with non-destructive error handling.

### Changes Required:

#### 1. Vite React TypeScript app

**File**: `frontend/` (package.json, vite.config.ts, index.html, src/main.tsx, src/App.tsx, etc.)

**Intent**: Create the companion UI host described in tech-stack / CryptoTools layout without relocating the API.

**Contract**: Dev server on `:5173`. Vite proxy `/api` → `https://localhost:7126` (or documented HTTP fallback). TypeScript + React. Tailwind optional for S-01 if it slows scaffolding — plain CSS is acceptable if the chart and form are usable.

#### 2. API client + load UI

**File**: `frontend/src/services/api.ts`, `frontend/src/components/Dashboard.tsx` (or equivalent)

**Intent**: Let the learner choose symbol + interval (editable defaults BTCUSDT / 1h), trigger load, store candles in component/app state, and show a clear error without clearing a previously successful series.

**Contract**: Client calls `GET /api/data/bybit` with symbol, interval, and a sensible default limit. UI exposes symbol and interval inputs + Load action. On failure: visible error message; previous candle array retained. On success: replace series and clear error.

### Success Criteria:

#### Automated Verification:

- Frontend installs and builds: `npm install` + `npm run build` in `frontend/`
- Typecheck passes if configured: `npm run typecheck` or `tsc --noEmit` when present

#### Manual Verification:

- With API running, Load for BTCUSDT 1h succeeds and candle count is visible in UI (e.g. status text) even before chart phase if chart is Phase 3-only — if chart is not yet wired, show count/raw confirmation
- Forced failure (bad symbol or API stopped) shows an error and does not wipe a prior successful load

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Chart + verification

### Overview

Render loaded candles with TradingView Lightweight Charts v5 and lock verification with one API smoke test plus a manual E2E checklist.

### Changes Required:

#### 1. Candlestick chart component

**File**: `frontend/src/components/TradingChart.tsx` (or equivalent)

**Intent**: Paint the in-memory candle series as candlesticks so FR-001’s “see them on the chart” is met.

**Contract**: Accepts candle array; maps Timestamp/OHLC into `lightweight-charts` candlestick series; resizes reasonably with the container. No buy/sell markers, no rectangle plugin required in S-01.

#### 2. Wire Dashboard → Chart

**File**: `frontend/src/components/Dashboard.tsx`, `frontend/src/App.tsx`

**Intent**: After a successful load, the chart updates to the new series.

**Contract**: Successful load updates chart props/state; empty initial state shows empty chart or placeholder, not a crash.

#### 3. API smoke test

**File**: test project under repo (e.g. `tests/TradingTutor.Tests/` or sibling) exercising ByBit client or `/api/data/bybit` with a mocked HTTP handler

**Intent**: One automated regression guard on the candle fetch contract without standing up a full E2E framework.

**Contract**: At least one test asserts that a canned ByBit kline JSON payload maps to the expected candle fields / non-empty result. Prefer mocking outbound HTTP over live ByBit in CI.

### Success Criteria:

#### Automated Verification:

- `dotnet build` and `dotnet test` pass
- `npm run build` in `frontend/` passes

#### Manual Verification:

- End-to-end: start API + `npm run dev` → open app → Load BTCUSDT 1h → candlesticks visible
- Change interval or symbol, Load again → chart updates
- Stop API or use invalid symbol → error shown; previous candlesticks remain if a prior load succeeded

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding / closing the change.

---

## Testing Strategy

### Unit Tests:

- ByBit response mapping / interval conversion with a fake `HttpMessageHandler` (Phase 3 smoke / Phase 1 if early)

### Integration Tests:

- Optional: WebApplicationFactory hitting `/api/data/bybit` with mocked exchange service — nice-to-have, not required if the handler-level smoke test covers the contract

### Manual Testing Steps:

1. Run API (`dotnet run`) and frontend (`npm run dev` in `frontend/`)
2. Load default BTCUSDT / 1h → confirm candlesticks
3. Change interval → Load → chart refreshes
4. Break API or symbol → error message; prior chart retained
5. Confirm no weatherforecast dependency remains for the happy path

## Performance Considerations

Keep default `limit` modest (e.g. 200–1000) so first paint stays snappy on a laptop. No caching layer in S-01.

## Migration Notes

Greenfield feature — no data migration. Removing `/weatherforecast` is intentional; update `trading-tutor.http` samples to the ByBit route.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` (FR-001)
- Inspiration: `Crypto_Tools_2_0_REPO_MAP.md` (MarketData, DataController, ByBitService, TradingChart, api.ts)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API candle fetch

#### Automated

- [x] 1.1 Solution builds: `dotnet build`
- [x] 1.2 API smoke / mapping test passes when present (`dotnet test`), or deferred explicitly to Phase 3
- [x] 1.3 `dotnet test` passes if a test project exists after this phase

#### Manual

- [x] 1.4 `GET /api/data/bybit?symbol=BTCUSDT&interval=1h&limit=50` returns non-empty OHLCV JSON while online
- [ ] 1.5 Weatherforecast is no longer the primary demo surface

### Phase 2: Frontend shell + load controls

#### Automated

- [ ] 2.1 `npm install` + `npm run build` succeed in `frontend/`
- [ ] 2.2 Typecheck passes when configured

#### Manual

- [ ] 2.3 Successful Load shows candle confirmation (count or data) with API running
- [ ] 2.4 Failed Load shows error and retains prior successful series

### Phase 3: Chart + verification

#### Automated

- [ ] 3.1 `dotnet build` and `dotnet test` pass
- [ ] 3.2 `npm run build` in `frontend/` passes

#### Manual

- [ ] 3.3 E2E: Load BTCUSDT 1h → candlesticks visible
- [ ] 3.4 Reload with different symbol/interval → chart updates
- [ ] 3.5 Failure path: error shown; previous candlesticks retained
