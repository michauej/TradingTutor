# CryptoTools 2.0 — Repository Map (AI Reference)

Use this file when starting a **new** project inspired by this repository. Prefer patterns and domain concepts over copying unfinished stubs.

Generated from a full source read of the repo. Skip `node_modules`, `bin`, `obj`, and `.git` when exploring.

---

## Product summary

CryptoTools 2.0 is a small crypto charting and backtest app:

- **Backend**: .NET 9 ASP.NET API pulls ByBit spot candles, runs trading strategies, returns backtest results and chart signals.
- **Frontend**: React 19 + TypeScript + Vite 7 + Tailwind 3 dashboard with TradingView Lightweight Charts.
- **Not present**: automated tests, `docs/` folder, `frontend/src/utils`, live exchange order placement, working EF/SQL persistence at runtime.

---

## How it fits together

```
Browser (Vite, :5173)
  Dashboard
    → axios  https://localhost:7227/api
API (net9.0)
  DataController        → IExchangeService (ByBitService)
  StrategiesController  → ITradingStrategy (MA, Order Block, Inducement)
                          → IExchangeService for candles
Core models  ←  Trading and Data both reference Core
Data (EF Core + SQL Server) exists in code; DbContext registration in Program.cs is commented out
```

### Project references

| Project | References |
|---|---|
| `CryptoTools.API` | Core, Data, Trading |
| `CryptoTools.Trading` | Core |
| `CryptoTools.Data` | Core |
| `CryptoTools.Core` | (none) |

---

## Tech stack

### Backend

- .NET 9 / ASP.NET Core Web API
- Swashbuckle (Swagger)
- Entity Framework Core + SQL Server (schema only; unused at runtime)
- Newtonsoft.Json
- HttpClient → ByBit REST API v5

### Frontend

- React 19, TypeScript, Vite 7
- Tailwind CSS 3, PostCSS, Autoprefixer
- axios
- `lightweight-charts` v5 + `fancy-canvas` (rectangle drawing plugin)
- `react-router-dom` installed but **unused** (App renders Dashboard only)

### Runtime ports

- Frontend: `http://localhost:5173`
- API HTTPS: `https://localhost:7227`
- API HTTP: `http://localhost:5013`
- Vite proxies `/api` → `https://localhost:7227`

---

## File tree

```
CryptoTools2.0/
├── README.md                          Product overview, setup, endpoint list (v1.0.0)
├── REPO_MAP.md                        This AI/human inspiration map
├── UPDATE_NODE_INSTRUCTIONS.md        Local note: Node 20.13 was too old for Vite 7
├── .gitignore                         Visual Studio + node_modules ignore list
├── .cursorrules                       Points Cursor at .cursor/rules
├── .cursor/rules/                     Editor rules only (persona, style, charts)
│
├── backend/
│   ├── CryptoTools.sln                Four projects: API, Core, Data, Trading
│   │
│   ├── CryptoTools.API/               ASP.NET host. References Core, Data, Trading
│   │   ├── Program.cs                 CORS, Swagger, ByBit + 3 strategies. DbContext off
│   │   ├── CryptoTools.API.csproj     net9.0, Swashbuckle, EF SQL Server, Newtonsoft
│   │   ├── CryptoTools.API.http       Sample HTTP calls for the IDE
│   │   ├── appsettings.json           LocalDB connection string; ByBit keys empty
│   │   ├── appsettings.Development.json
│   │   ├── Properties/launchSettings.json   HTTPS :7227, HTTP :5013
│   │   ├── Middleware/GlobalExceptionHandler.cs   JSON error body for unhandled exceptions
│   │   └── Controllers/
│   │       ├── DataController.cs      GET bybit, symbols, test-connection, test-current
│   │       └── StrategiesController.cs
│   │                                  GET strategies; POST backtest; POST execute
│   │
│   ├── CryptoTools.Core/              Shared models. No behavior
│   │   ├── Class1.cs                  Empty class left from the project template
│   │   └── Models/
│   │       ├── MarketData.cs          Candle, request, and response
│   │       ├── Exchange.cs            Saved exchange, runtime config, symbol limits
│   │       ├── Signal.cs              Chart marker (price, shape, color, type)
│   │       └── TradingStrategy.cs     Strategy, execution, backtest result, enums
│   │                                  Enum also lists RSI, MACD, Bollinger, Custom
│   │
│   ├── CryptoTools.Data/              EF Core. References Core. Not used at runtime
│   │   └── CryptoToolsDbContext.cs    MarketData, strategies, executions, backtests, exchanges
│   │
│   └── CryptoTools.Trading/           Exchange + strategies. References Core
│       ├── Interfaces/
│       │   ├── IExchangeService.cs    Candles, symbols, connection test
│       │   └── ITradingStrategy.cs    Execute, backtest, defaults, validate
│       ├── Services/ByBitService.cs   ByBit v5 spot klines and instruments
│       └── Strategies/
│           ├── MovingAverageStrategy.cs    SMA crossover buy/sell and backtest
│           ├── OrderBlockStrategy.cs       Volume/price zones, then trade those zones
│           └── InducementStrategy.cs       Swing highs/lows and inducements; no orders
│
└── frontend/                          React 19 + TypeScript + Vite 7 + Tailwind 3
    ├── package.json                   axios, lightweight-charts 5, react-router-dom 7
    ├── package-lock.json
    ├── vite.config.ts                 Dev proxy /api → https://localhost:7227
    ├── index.html
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── eslint.config.js
    ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
    ├── README.md
    └── src/
        ├── main.tsx                   React root
        ├── App.tsx                    Renders Dashboard only (router is installed, unused)
        ├── index.css                  Tailwind entry
        ├── App.css                    Vite starter styles, unused by App
        ├── vite-env.d.ts
        ├── services/api.ts            Types + dataApi + strategiesApi (base URL :7227)
        ├── plugins/rectangle-drawing-tool.ts
        │                              Lightweight Charts plugin that draws price rectangles
        └── components/
            ├── Dashboard.tsx          Symbol, interval, loads candles and strategies
            ├── TradingChart.tsx       Candles, buy/sell markers, signal rectangles
            ├── StrategyPanel.tsx      Pick strategy, edit params, run backtest
            └── StrategyActions.tsx    List of Buy / Sell / Hold rows
```

README also mentions `frontend/public`, `frontend/src/utils`, and `docs/`; those folders are **not** in the repo.

---

## API surface

### Data (`DataController`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/data/bybit` | Fetch ByBit OHLCV (`symbol`, `interval`, `startTime`, `endTime`, `limit`) |
| GET | `/api/data/symbols` | List exchange symbols |
| GET | `/api/data/test-connection` | Ping ByBit |
| GET | `/api/data/test-current` | Fetch recent BTCUSDT 1h candles |

### Strategies (`StrategiesController`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/strategies` | List registered strategies + default parameters |
| POST | `/api/strategies/backtest` | Fetch candles, run strategy backtest, return `BacktestResult` |
| POST | `/api/strategies/execute` | Run strategy on recent candles; returns `StrategyExecution` (no live ByBit order) |

---

## Domain concepts

### Market candle (`MarketData`)

`Symbol`, `Exchange`, `Open`, `High`, `Low`, `Close`, `Volume`, `Timestamp`, `Interval` (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`, …).

### Strategy contract (`ITradingStrategy`)

- `Name`, `Description`, `Type`
- `ExecuteAsync(marketData, parameters)` → optional live signal / execution object
- `BacktestAsync(marketData, parameters, initialBalance)` → `BacktestResult`
- `GetDefaultParameters()`, `ValidateParameters(...)`

### Strategy types (`StrategyType` enum order — numbers the UI sends)

| Value | Name | Status in this repo |
|---|---|---|
| 0 | MovingAverage | Implemented (SMA crossover) |
| 1 | RSI | Enum only |
| 2 | MACD | Enum only |
| 3 | BollingerBands | Enum only |
| 4 | OrderBlock | Implemented (volume/price zones) |
| 5 | Inducement | Implemented (analysis / markers; no trades) |
| 6 | Custom | Enum only |

### Backtest result

`InitialBalance`, `FinalBalance`, `TotalReturn`, `MaxDrawdown`, `TotalTrades`, `WinningTrades`, `LosingTrades`, `WinRate`, `SharpeRatio`, plus lists of `Trades`, `Actions`, and chart `Signals`.

### Chart signals (`Signal`)

`Timestamp`, `Price`, `Text`, `Position`, `Color`, `Shape`, `Type`, optional `Metadata` — used to mark the Lightweight Chart.

### Exchange abstraction (`IExchangeService`)

`GetMarketDataAsync`, `GetSymbolsAsync`, `TestConnectionAsync`, `ExchangeName`. Current implementation: **ByBit** public spot market (`/v5/market/kline`, instruments).

---

## What is actually built

| Area | State |
|---|---|
| ByBit candles and symbol list | Working public market calls |
| Moving-average crossover | Execute + backtest (short/long period, quantity) |
| Order block | Looks for high-volume zones, then backtests them |
| Inducement | Marks swings; `ExecuteAsync` returns no trade |
| Chart | Candlesticks, markers, rectangle plugin |
| Dashboard | One page: symbol, interval, strategy, backtest |
| SQL Server / EF | Schema is mapped; the API never opens the database |
| Live orders | `POST /api/strategies/execute` returns a signal object; it does not send an order to ByBit |
| RSI, MACD, Bollinger | Names on the `StrategyType` enum only |
| Auth, portfolio, tests | Absent |

---

## Worth keeping for a new project (inspiration)

1. Split of **API / models / exchange / strategies**, with `IExchangeService` and `ITradingStrategy`.
2. Candle shape in `MarketData` and the backtest result (balance, drawdown, win rate, trades, chart signals).
3. ByBit kline URL shape in `ByBitService` (`/v5/market/kline`, spot category, interval conversion).
4. Chart composition: `TradingChart` plus a drawing plugin, fed by strategy signals.
5. Flow on one screen: load candles → pick strategy → post backtest → paint markers.
6. Global API exception middleware returning a consistent JSON error body.

---

## Leave behind / do not copy blindly

- Empty `Class1.cs` template leftover
- Unused `react-router-dom` dependency
- Commented-out `DbContext` registration (and assuming persistence works)
- `UPDATE_NODE_INSTRUCTIONS.md` (environment-specific)
- `.cursor/rules` unless you want the same Cursor persona/style for the new repo
- Secrets: do not copy filled ByBit keys; keep them out of source control
- Generated folders: `node_modules`, `bin`, `obj`, `.vs`

---

## Suggested next-project starting shape

```
NewProject/
├── backend/
│   ├── Api/           Controllers, Program, middleware
│   ├── Core/          MarketData, Signal, BacktestResult, enums
│   ├── Exchanges/     IExchangeService + ByBit (or others)
│   └── Strategies/    ITradingStrategy + concrete strategies
└── frontend/
    └── src/
        ├── services/api.ts
        ├── components/ (Dashboard, Chart, StrategyPanel)
        └── plugins/ (chart drawing tools)
```

Wire persistence later if needed. Prefer strategy plugins and exchange adapters over a monolith controller.

---

## Key source paths (quick open)

- `backend/CryptoTools.API/Program.cs`
- `backend/CryptoTools.API/Controllers/DataController.cs`
- `backend/CryptoTools.API/Controllers/StrategiesController.cs`
- `backend/CryptoTools.Trading/Services/ByBitService.cs`
- `backend/CryptoTools.Trading/Strategies/MovingAverageStrategy.cs`
- `backend/CryptoTools.Trading/Strategies/OrderBlockStrategy.cs`
- `backend/CryptoTools.Trading/Strategies/InducementStrategy.cs`
- `backend/CryptoTools.Core/Models/TradingStrategy.cs`
- `frontend/src/components/Dashboard.tsx`
- `frontend/src/components/TradingChart.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/plugins/rectangle-drawing-tool.ts`
