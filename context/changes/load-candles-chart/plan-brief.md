# Load Candles Chart — Plan Brief

> Full plan: `context/changes/load-candles-chart/plan.md`

## What & Why

Stand up the first sim slice (roadmap S-01 / FR-001): download historical ByBit spot candles before a session and show them on a candlestick chart. This also introduces the React companion UI the tech-stack expects beside the ASP.NET API.

## Starting Point

Repo is a bare .NET 10 Web API with a weatherforecast sample and no frontend. CryptoTools 2.0 patterns (MarketData, ByBit klines, lightweight-charts) are documented in `Crypto_Tools_2_0_REPO_MAP.md` for reuse as concepts, not a brownfield base.

## Desired End State

Learner opens the local UI, sets symbol/interval (defaults BTCUSDT / 1h), loads candles via the API, and sees candlesticks. Fetch errors are visible and do not wipe a previously good series.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| Load path | ByBit pre-session download only | Fastest CryptoTools-aligned path; file import deferred under speed |
| Chart stack | React + Vite + lightweight-charts v5 | Matches inspiration map; markers later for diary |
| Candle storage | API returns; React holds in memory | Same as CryptoTools runtime (no DB) |
| Symbol scope | Single symbol + interval, editable defaults | FR-011 multi-symbol parked |
| Failure UX | Error message; keep prior series | Safe for later playback work |
| Repo layout | `frontend/` at root; API stays at root | Familiar shape without a big move |
| Verification | Manual E2E + one API smoke test | Enough guardrail without heavy test scaffolding |
| ByBit auth | Public klines, no API keys | Zero secrets for S-01 |

## Scope

**In scope:** ByBit candle endpoint, CORS, React load UI, candlestick chart, smoke test, remove weatherforecast as primary demo.

**Out of scope:** File import, playback, trading, diary/AI, multi-symbol, EF/SQL, API keys, sample JSON fallback, `backend/` relocation.

## Architecture / Approach

Browser (`frontend/` :5173) → Vite `/api` proxy → ASP.NET (`/api/data/bybit`) → `IExchangeService` / ByBit `/v5/market/kline` → OHLCV JSON → React state → `TradingChart` (lightweight-charts).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. API candle fetch | Models + ByBit client + GET endpoint + CORS | ByBit payload/interval mapping bugs |
| 2. Frontend shell + load | Vite app, form, stateful load + errors | Proxy/CORS mismatch with HTTPS |
| 3. Chart + verification | Candlesticks + smoke test + E2E checklist | Chart time/OHLC mapping off-by-one |

**Prerequisites:** Node.js for Vite; network access to ByBit public API for manual E2E.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- ByBit public spot klines remain reachable without keys from the learner’s network.
- Holding candles only in React memory is enough until later slices need server-side session state.
- Default limit stays modest so first paint stays usable on a laptop.

## Success Criteria (Summary)

- Load BTCUSDT 1h shows candlesticks in the local UI
- Bad fetch shows an error and keeps the previous chart
- `dotnet test` smoke + `npm run build` succeed
