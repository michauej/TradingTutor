# Backend Clean-up Implementation Plan

## Overview

Refactor the TradingTutor backend so session, candle load, and coach each have clear boundaries, and add request/exception middleware plus OpenTelemetry traces with `ILogger` coverage. HTTP product behavior stays the same except two intentional tidies: unknown intervals throw, and coach persistence moves out of the analyze service into the controller.

## Current State Analysis

`SessionService` (~870 lines in `backend/TradingTutor.Trading/Services/SessionService.cs`) owns lifecycle, trading commands, advance/sim clock, and interval reanchor. Trading math already lives in `PaperTradingEngine`; commands go through `SessionCommandLock`. Only `SessionsController` and tests call it (concrete type, no interface).

`CandleLoadService.LoadAsync` is one linear method (validate → local pack → overlap → exchange pages → merge/save → page). There is no pipeline/step framework in the repo.

Interval mapping is duplicated and inconsistent: `SessionService.IntervalDurationMs` (default 1h), unused `CandleInterval.ToDuration` (throws), `ByBitService.ConvertInterval` (pass-through unknown). Frontend has separate ms maps (out of scope).

`CoachAnalyzeService` already exposes pure `AnalyzeTradesAsync(IReadOnlyList<ClosedTradeInput>)`, but `AnalyzeBySessionAsync` loads/saves via `ISessionRepository`. It also owns rules + lecture + LM + parse. Logging exists on some types; `SessionService` has none. No OpenTelemetry packages; no custom middleware; controllers use per-action try/catch.

## Desired End State

- Session commands are implemented in focused services; `SessionService` is a thin facade that keeps the same public methods for the controller.
- Candle load runs through named internal steps: CacheCheck → FetchIfNeeded → MergeAndSave → PageResult.
- One shared interval util provides duration and ByBit label mapping; unknown intervals throw.
- Coach analyze takes trades and returns a DTO; `CoachController` loads the session and persists coach fields. LM call + parse live in a separate service.
- API hosts exception + request-logging middleware and OpenTelemetry traces; previously silent services use `ILogger`.
- Existing tests stay green; new targeted tests cover the new contracts.

### Key Discoveries:

- `SessionsController` is the sole production caller of `SessionService` (`Program.cs` registers Scoped concrete) — facade keeps controller churn low.
- `CloseAsync` modes (`fifo` / `lotId|lot` / `qty` / `all`) and mark resolution must move with trade commands unchanged.
- `CandleInterval` has no external callers — safe to replace with the shared util.
- Coach tests for `AnalyzeBySessionAsync` must move to controller/persist coverage after SRP split.
- Target framework is `net10.0`; OTel packages must match that stack.

## What We're NOT Doing

- Frontend interval map unification (`candleLoadRange.ts`, `intervalSwitch.ts`, `snapToCandle.ts`)
- OpenTelemetry metrics or ILogger→OTLP logs bridge
- Introducing `ISessionService` / trade interfaces (concrete DI stays)
- Changing HTTP route shapes or close-mode semantics
- Replacing per-domain status mapping with a single generic 500 (middleware must preserve 400/404/502 mappings)
- Azure Table / alternate session repository
- Full coach pipeline framework (validate/rules/prompt as separate step types)

## Implementation Approach

Work in dependency order: shared interval util first (behavior change: throw), then extract session command services behind a facade, then candle internal steps, then coach persist + LLM extract, then observability. Each phase must keep `dotnet test` green. Prefer move-and-delegate over rewrite so `PaperTradingEngine` and pack merge logic stay put.

## Critical Implementation Details

**Unknown interval policy:** After Phase 1, any former silent default to 1h becomes an exception. Call sites that previously relied on default (tip window, watermark, playhead, ByBit query) must either receive valid labels only or surface a validation error to the client.

**Session lock:** Every mutating facade method must still run under `WithSessionLockAsync` / `SessionCommandLock`. Extracted services must not open a second lock path.

**Coach persist race:** Moving upsert to the controller does not add `SessionCommandLock` around coach write unless explicitly extended; document that concurrent trade commands vs coach analyze remains an existing risk, not newly fixed.

**Exception middleware vs controllers:** Map known domain exceptions (`SessionCommandException`, `SessionNotFoundException`, `CandleLoadValidationException`, `ArgumentException`, `KeyNotFoundException`, `LmStudioException`) to the same status codes controllers use today before deleting catch blocks.

---

## Phase 1: Shared Interval Util

### Overview

Introduce one interval utility with duration and ByBit label APIs that throw on unknown input; replace the three backend maps and add tests.

### Changes Required:

#### 1. IntervalParser

**File**: `backend/TradingTutor.Trading/Services/IntervalParser.cs` (new)

**Intent**: Single source for chart/session interval aliases → duration and ByBit API token, including numeric aliases used by session (`1`, `5`, `15`, `60`, `240`).

**Contract**: Public static API e.g. `ToDuration(string) → TimeSpan`, `ToDurationMs(string) → double`, `ToByBitInterval(string) → string`. Unknown/blank → throw a clear validation exception (reuse `CandleLoadValidationException` or a dedicated type). Month `1M`/`M` handled before lowercasing (same as today).

#### 2. Replace call sites

**File**: `backend/TradingTutor.Trading/Services/SessionService.cs`

**Intent**: Remove `IntervalDurationMs`; use `IntervalParser` in tip window / watermark / playhead helpers.

**Contract**: Same helper call sites (~559, ~684, ~777) call the shared util; private switch deleted.

#### 3. Replace CandleInterval

**File**: `backend/TradingTutor.Trading/Services/CandleInterval.cs`

**Intent**: Delete or thin to wrappers that delegate to `IntervalParser` so no duplicate switch remains.

**Contract**: No divergent mapping tables left in Trading project for duration.

#### 4. ByBit mapping

**File**: `backend/TradingTutor.Trading/Services/ByBitService.cs`

**Intent**: `ConvertInterval` delegates to `IntervalParser.ToByBitInterval` (or is removed and call site updated).

**Contract**: Unknown intervals no longer pass through raw keys; they throw. Update `ByBitServiceTests` accordingly.

### Success Criteria:

#### Automated Verification:

- Solution builds: `dotnet build`
- Unit tests pass: `dotnet test`
- New interval theory tests cover common labels, numeric aliases, `1M`, and at least one unknown → throw
- ByBit interval tests updated for throw-on-unknown

#### Manual Verification:

- Spot-check: start a session and switch among chart intervals `1m`/`5m`/`15m`/`1h`/`4h`/`1d` still works
- Confirm an intentionally bad interval returns a validation error instead of silent 1h behavior

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: SessionService Split (Facade)

### Overview

Extract trading, advance, and interval-reanchor into focused services; keep `SessionService` as a thin facade with the same public method surface for `SessionsController`.

### Changes Required:

#### 1. TradeCommandService

**File**: `backend/TradingTutor.Trading/Services/TradeCommandService.cs` (new)

**Intent**: Own open / close / place / cancel command bodies currently in `SessionService` (including `CloseAsync` mode switch).

**Contract**: Methods accept the loaded `TradingSession` (or session id + repo collaboration pattern matching the facade), use `PaperTradingEngine` + candle mark resolution as today, persist via repository. Close modes remain `fifo` | `lotId`/`lot` | `qty` | `all`.

#### 2. AdvanceService

**File**: `backend/TradingTutor.Trading/Services/AdvanceService.cs` (new)

**Intent**: Own `AdvanceAsync` candle-driven simulation (playhead, limit match, sim clock).

**Contract**: Same inputs/outputs as current `AdvanceAsync`; still ensures candles cover playhead via `ICandleLoadService`.

#### 3. IntervalReanchorService

**File**: `backend/TradingTutor.Trading/Services/IntervalReanchorService.cs` (new)

**Intent**: Own `ReanchorIntervalAsync` (interval switch without fills).

**Contract**: Uses `IntervalParser` for duration math; same HTTP-facing errors as today plus strict unknown interval.

#### 4. Thin SessionService facade

**File**: `backend/TradingTutor.Trading/Services/SessionService.cs`

**Intent**: Keep Create/Get/List/Start/Lock and delegate Open/Close/Place/Cancel/Advance/Reanchor to the new services under the existing lock helper.

**Contract**: Public method signatures used by `SessionsController` unchanged. Constructor gains focused services (or creates them) plus `ILogger<SessionService>`. Shared private helpers (tip window, playhead) move to the service that needs them or a small internal static helper type — no logic duplication.

#### 5. DI + tests

**File**: `backend/TradingTutor.API/Program.cs`

**Intent**: Register the three new scoped services; facade remains Scoped.

**Contract**: `AddScoped` for each new service; controller registration unchanged.

**File**: `tests/TradingTutor.Tests/SessionServiceTests.cs`, `SessionCommandServiceTests.cs`

**Intent**: Construct facade with new dependencies (or test focused services directly where clearer); keep behavioral assertions.

**Contract**: Existing command scenarios still pass (close modes, advance, reanchor).

### Success Criteria:

#### Automated Verification:

- `dotnet build`
- `dotnet test`
- No production caller other than facade/controller needs updates (grep `OpenAsync`/`AdvanceAsync` etc.)

#### Manual Verification:

- Exercise session start, advance, open, close (each mode if feasible), place/cancel order, interval switch from the UI or HTTP
- Confirm concurrent commands on one session still serialize (no double-fill / corrupt snapshot)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Candle Load Pipeline Steps

### Overview

Decompose `CandleLoadService.LoadAsync` into internal step types orchestrated in order, without introducing a shared pipeline framework.

### Changes Required:

#### 1. Internal step types

**File**: `backend/TradingTutor.Trading/Services/CandleLoad/` (new folder) or sibling types under Services

**Intent**: Implement CacheCheck, FetchIfNeeded (incl. overlap + `PageExchangeAsync` + fallbacks), MergeAndSave, PageResult as internal classes with a small shared context DTO.

**Contract**: `ICandleLoadService.LoadAsync` signature and `CandleLoadResult` shape unchanged. Fallbacks that return local + `incomplete: true` preserved.

#### 2. Orchestrator

**File**: `backend/TradingTutor.Trading/Services/CandleLoadService.cs`

**Intent**: `LoadAsync` validates inputs then runs steps in fixed order; logging stays meaningful per step.

**Contract**: Public interface unchanged; DI registration unchanged (`ICandleLoadService` → `CandleLoadService`).

#### 3. Tests

**File**: `tests/TradingTutor.Tests/CandleLoadServiceTests.cs` (+ optional step-focused tests)

**Intent**: Keep coverage of cache hit, exchange merge, and fallback paths; add at least one test that targets a step seam if reachable.

**Contract**: Existing candle load scenarios green.

### Success Criteria:

#### Automated Verification:

- `dotnet build`
- `dotnet test`
- Candle load tests still cover local short-circuit and incomplete fallback

#### Manual Verification:

- `GET api/data/candles` for a symbol/interval with warm local pack returns `source: local`
- Force refresh / cold pack still merges and serves candles
- Session advance still loads packs when needed

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Coach SRP + LLM Extract

### Overview

Remove session persistence from the analyze service (controller owns load/save); extract LM + parse into a dedicated service. Rules orchestration stays in `CoachAnalyzeService`.

### Changes Required:

#### 1. Pure CoachAnalyzeService

**File**: `backend/TradingTutor.Coaching/CoachAnalyzeService.cs`

**Intent**: Drop `ISessionRepository` and `AnalyzeBySessionAsync`. Public entry analyzes `IReadOnlyList<ClosedTradeInput>` and returns `CoachAnalyzeResponse`.

**Contract**: Constructor deps: `RulePack`, lecture/prompt collaborators, `CoachLlmAnalyzer` (or equivalent), `ILogger`. No repository.

#### 2. CoachLlmAnalyzer

**File**: `backend/TradingTutor.Coaching/CoachLlmAnalyzer.cs` (new; name may vary)

**Intent**: Own LM Studio call + `CoachResponseParser` (+ prompt assembly if that keeps analyze thinner).

**Contract**: Clear method e.g. analyze-from-prompt or from trades+findings → verdict/analysis; propagate `LmStudioException`.

#### 3. CoachController persist

**File**: `backend/TradingTutor.API/Controllers/CoachController.cs`

**Intent**: Inject `ISessionRepository`; load session by `sessionId`; call pure analyze with `ClosedTrades`; write coach fields; `CreateSessionAsync`; return DTO.

**Contract**: `POST api/coach/analyze` request/response JSON unchanged. Same status codes for not-found / validation / LM failure (until Phase 5 middleware absorbs catches).

#### 4. DI + tests

**File**: `backend/TradingTutor.API/Program.cs`

**Intent**: Register `CoachLlmAnalyzer`; `CoachAnalyzeService` ctor update.

**File**: `tests/TradingTutor.Tests/CoachAnalyzeServiceTests.cs`

**Intent**: Remove/`obsolete` `AnalyzeBySessionAsync` tests; keep `AnalyzeTradesAsync` tests; add controller or persist-focused test for load→analyze→save if practical (WebApplicationFactory optional; otherwise a small orchestration test helper).

**Contract**: Persist behavior still verified somewhere; pure analyze has no repo fake requirement.

### Success Criteria:

#### Automated Verification:

- `dotnet build`
- `dotnet test`
- Coach analyze unit tests pass without `ISessionRepository` on the analyze service

#### Manual Verification:

- From diary UI, run coach analyze on a session with ≥5 closed trades; verdict/analysis persist and reload
- Missing session still returns 404; &lt;5 trades still 400; LM down still 502

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Logging, Middleware, OpenTelemetry Traces

### Overview

Add exception + request-logging middleware, fill `ILogger` gaps on new/session services, and enable ASP.NET Core OpenTelemetry traces (HTTP + key activities). No metrics exporter and no OTLP logs bridge.

### Changes Required:

#### 1. Exception middleware

**File**: `backend/TradingTutor.API/Middleware/ExceptionHandlingMiddleware.cs` (new)

**Intent**: Central ProblemDetails mapping for known domain exceptions; log unexpected errors.

**Contract**: Status mapping parity with current controllers (see Critical Implementation Details). Safe to remove redundant catch blocks afterward without changing client-visible codes.

#### 2. Request logging middleware

**File**: `backend/TradingTutor.API/Middleware/RequestLoggingMiddleware.cs` (new)

**Intent**: Log method, path, status, elapsed ms at Information (or Debug for noise control).

**Contract**: Registered early in the pipeline; does not alter responses.

#### 3. Pipeline wiring + OTel

**File**: `backend/TradingTutor.API/Program.cs`, `TradingTutor.API.csproj`, `appsettings*.json`

**Intent**: `UseMiddleware` for both middlewares; add OpenTelemetry tracing packages appropriate for `net10.0`; instrument ASP.NET Core; optional console exporter in Development and/or OTLP via config. Add custom `ActivitySource` spans for high-value ops (session command, candle load, coach analyze) where low-cost.

**Contract**: App runs without external collector (console or no-op). Config keys documented in appsettings comments or foundation notes only if needed — prefer standard OTel env/config patterns.

#### 4. ILogger gaps

**Files**: New session-focused services + facade; any remaining silent hotspots from this clean-up

**Intent**: Information/Warning on command start/fail and candle incomplete paths already covered stay consistent.

**Contract**: No PII-heavy payloads in logs; session id / symbol ok.

### Success Criteria:

#### Automated Verification:

- `dotnet build`
- `dotnet test`
- At least one test asserting exception middleware maps a known exception to the expected status (middleware unit test or TestServer)

#### Manual Verification:

- Trigger a validation error and a not-found; response shape stays ProblemDetails with correct codes
- Confirm request logs appear for API calls in Development
- Confirm traces appear on console (Dev) or configured exporter when a session command and coach analyze run

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `IntervalParser`: aliases, month edge, unknown throws, ByBit tokens
- Session command / facade: existing close/advance/reanchor scenarios
- Candle load: cache hit, incomplete fallback; optional step isolation
- Coach: pure analyze paths; LM failure; persist covered at controller/orchestration
- Middleware: one mapped exception → status code

### Integration Tests:

- Not required as a new project; `dotnet test` + manual HTTP/UI passes per phase

### Manual Testing Steps:

1. Full paper-session loop: start → load chart → advance → open/close → interval switch
2. Candle endpoint local vs refresh
3. Coach analyze success + error paths
4. Confirm bad interval fails closed (no silent 1h)
5. Skim logs/traces after Phase 5

## Performance Considerations

Pipeline/facade extractions should be move-only (no extra pack reads). OTel tracing overhead must stay acceptable in Development; avoid per-candle spans inside pagination loops — prefer one span per `LoadAsync` / command.

## Migration Notes

No data migration. Strict interval throwing is a client-visible behavior change for invalid labels only. Coach persistence ownership changes server-side only; FE still posts `{ sessionId }`.

## References

- Session entry: `backend/TradingTutor.Trading/Services/SessionService.cs`
- Candle load: `backend/TradingTutor.Trading/Services/CandleLoadService.cs`
- Coach: `backend/TradingTutor.Coaching/CoachAnalyzeService.cs`
- API host: `backend/TradingTutor.API/Program.cs`
- Tests: `tests/TradingTutor.Tests/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared Interval Util

#### Automated

- [x] 1.1 Solution builds: `dotnet build`
- [x] 1.2 Unit tests pass: `dotnet test`
- [x] 1.3 New interval theory tests cover common labels, numeric aliases, `1M`, and at least one unknown → throw
- [x] 1.4 ByBit interval tests updated for throw-on-unknown

#### Manual

- [ ] 1.5 Spot-check: start a session and switch among chart intervals `1m`/`5m`/`15m`/`1h`/`4h`/`1d` still works
- [ ] 1.6 Confirm an intentionally bad interval returns a validation error instead of silent 1h behavior

### Phase 2: SessionService Split (Facade)

#### Automated

- [x] 2.1 `dotnet build`
- [x] 2.2 `dotnet test`
- [x] 2.3 No production caller other than facade/controller needs updates

#### Manual

- [ ] 2.4 Exercise session start, advance, open, close, place/cancel order, interval switch
- [ ] 2.5 Confirm concurrent commands on one session still serialize

### Phase 3: Candle Load Pipeline Steps

#### Automated

- [x] 3.1 `dotnet build`
- [x] 3.2 `dotnet test`
- [x] 3.3 Candle load tests still cover local short-circuit and incomplete fallback

#### Manual

- [ ] 3.4 `GET api/data/candles` warm pack returns `source: local`
- [ ] 3.5 Force refresh / cold pack still merges and serves candles
- [ ] 3.6 Session advance still loads packs when needed

### Phase 4: Coach SRP + LLM Extract

#### Automated

- [x] 4.1 `dotnet build`
- [x] 4.2 `dotnet test`
- [x] 4.3 Coach analyze unit tests pass without `ISessionRepository` on the analyze service

#### Manual

- [ ] 4.4 Diary coach analyze persists and reloads for ≥5 closed trades
- [ ] 4.5 Missing session 404; &lt;5 trades 400; LM down 502

### Phase 5: Logging, Middleware, OpenTelemetry Traces

#### Automated

- [x] 5.1 `dotnet build`
- [x] 5.2 `dotnet test`
- [x] 5.3 Exception middleware maps a known exception to the expected status

#### Manual

- [ ] 5.4 Validation and not-found still return correct ProblemDetails codes
- [ ] 5.5 Request logs appear for API calls in Development
- [ ] 5.6 Traces appear on console or configured exporter for session command and coach analyze
