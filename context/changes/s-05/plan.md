# AI Verdict / Analysis Implementation Plan

## Overview

Implement roadmap S-05 (FR-010 / US-01 AI half): from Trader’s Diary, with ≥5 closed trades, the learner requests analysis; the ASP.NET API runs a small fixed logic-rule pack over the posted journal, calls a local LM Studio OpenAI-compatible chat endpoint with a fixed head prompt + rule findings (+ optional lecture PDF folder text), and returns Verdict/Analysis for a panel under the diary chart. NFR target: usable reply within ~30s. No session persistence this slice.

## Current State Analysis

- S-04 delivered `/diary` with markers/spans, filters, and in-memory `closedTrades` / `lots` via `SessionProvider` (`frontend/src/session/SessionContext.tsx`, `frontend/src/components/DiaryPage.tsx`). Diary is available anytime after session lock; there is **no** AI panel and **no** ≥5 gate.
- Domain journal shape is frontend-only: `ClosedTrade` in `frontend/src/trading/types.ts` (side, qty, entry/exit price & time, realizedPnl). Refresh clears state.
- Backend exposes only `GET /api/data/bybit` (`DataController`); `Program.cs` registers `AddHttpClient<IExchangeService, ByBitService>()`. No coach DTOs, LLM client, prompts, or PDF config.
- Tests: frontend Vitest for pure modules; backend xUnit stubs `HttpMessageHandler` against services (`ByBitServiceTests`) — no `WebApplicationFactory`.
- Roadmap lists this slice as **blocked** on LLM runtime + PDF supply; planning decisions unlock it (LM Studio + optional PDF folder). Change folder id is `s-05`; roadmap **Change ID** is `ai-coach-verdict` (name mismatch — see References).

## Desired End State

After a locked sim session with ≥5 closed trades, the learner opens `/diary`, sees Analyze enabled (with a short “need N more” hint when under threshold), clicks Analyze, and — while LM Studio is reachable — receives a single success payload rendered below the chart: rule findings list + Verdict + Analysis text. Under 5 closes, Analyze stays disabled. On LLM/API failure, the UI shows an all-or-nothing error with Retry (no partial findings). Empty or missing PDF folder still works (prompt = head + rules + trades). Refresh still clears the in-memory journal. Rules and mocked-LLM API paths are automated; live LM Studio quality is manual.

### Key Discoveries:

- Natural API pattern: mirror `DataController` — `Problem` 400 for validation, 502 for upstream LM failures, honor `CancellationToken` (`backend/TradingTutor.API/Controllers/DataController.cs`).
- Frontend should extend `frontend/src/services/api.ts` (`ApiError` + Vite `/api` proxy); browser must not call LM Studio directly (CORS/secrets).
- Coach panel mount: new section on `DiaryPage` after the chart / before or beside trade tables — reuse `.diary-trades` section heading pattern (`DiaryPage.tsx`).
- Solution today: API + Core + Trading only (`TradingTutor.slnx`); a new `TradingTutor.Coaching` project keeps rules/LLM out of ByBit `Trading`.

## What We're NOT Doing

- Persistence (localStorage / backend session store) — analyze live `closedTrades` from SessionProvider only
- FR-014 single-transaction analysis; FR-013 richer coach context over time
- Calling LM Studio from the browser
- Streaming tokens to the UI (one-shot JSON response)
- Configurable rules DSL / JSON rule editor
- Soft-gate or always-on Analyze that returns “not enough trades” after click (hard disable under 5)
- Partial success UI (rule findings without Verdict) when LLM fails — all-or-nothing per product decision
- Mandatory End Session
- Live exchange orders / real money
- Renaming the change folder to `ai-coach-verdict` (document mismatch only)
- Default-CI dependency on a running LM Studio instance

## Implementation Approach

1. Add `TradingTutor.Coaching` (+ Core DTOs): pure fixed rule pack (3–5 rules including the PRD “after long, ~0.5% adverse move” example) producing structured findings; unit-test rules with no HTTP.
2. Wire LM Studio via typed `HttpClient` (OpenAI-compatible chat completions), assemble prompt from fixed head prompt + findings + closed-trade summary + optional PDF-folder text, expose `POST /api/coach/analyze` that validates ≥5 trades, runs rules, calls LLM, returns combined success DTO or `Problem` error (no partial body on LLM failure).
3. Diary UI: `fetchCoachAnalyze` in `api.ts`, ≥5 enablement + hint, panel below chart (idle / loading / success / error+Retry). Vitest covers gate helpers and request mapping; live LM Studio verified manually.

## Critical Implementation Details

### Timing & lifecycle

Configure the LM Studio `HttpClient` timeout so a hung local model fails near the ~30s NFR (e.g. ~30s request timeout) and surfaces as a failed Analyze with Retry — do not leave the diary spinner unbounded.

### State sequencing

Run rules before the LLM call inside the API orchestration, but **only return findings in the HTTP 200 body together with Verdict/Analysis**. If the LLM call fails after rules succeeded, return an error response with **no** findings payload so the UI stays all-or-nothing.

## Phase 1: Rules engine + coach contracts

### Overview

Introduce Core request/response/finding DTOs and a pure fixed rule pack in `TradingTutor.Coaching`, covered by xUnit — no LM Studio or controller yet.

### Changes Required:

#### 1. Solution project + Core DTOs

**File**: `backend/TradingTutor.Coaching/TradingTutor.Coaching.csproj`, `TradingTutor.slnx`, `backend/TradingTutor.Core/` (coach/trade DTOs)

**Intent**: Give the coach pipeline a home that mirrors API/Core/Trading separation and shared serializable contracts the API and tests can reference.

**Contract**:
- Add `TradingTutor.Coaching` class library targeting the same TFM as sibling projects; reference Core; register project in `TradingTutor.slnx` under `/backend/`.
- Core DTOs aligned with frontend journal fields: closed-trade input (id, side, qty, entry/exit price & time, realizedPnl), rule finding (id/code, severity or kind, human-readable message, optional related trade ids), analyze request/response shapes (response may be stubbed until Phase 2 fills verdict fields).
- Side enum/string contract must round-trip with frontend `'long' | 'short'`.

#### 2. Fixed rule pack (3–5 rules)

**File**: `backend/TradingTutor.Coaching/` (e.g. rules evaluator + individual rule types)

**Intent**: Produce deterministic coaching signal from closed trades before any LLM call, matching PRD Business Logic “logic rules + coaching analysis.”

**Contract**:
- Pure function/service: input `IReadOnlyList` of closed-trade DTOs → list of findings (stable rule ids).
- Include at least: adverse ~0.5% move after/for longs (PRD example); mirror or related short-side adverse move; plus 1–3 additional fixed behavioral rules (e.g. loss clustering, very short hold, low win rate on the batch) — exact formulas documented in code comments, not a DSL.
- No candle series input (trades-only rules for MVP).
- Empty trade list → empty findings (controller will reject &lt;5 later).

#### 3. xUnit coverage for rules

**File**: `tests/TradingTutor.Tests/` + update `TradingTutor.Tests.csproj` ProjectReference to Coaching (and Core as needed)

**Intent**: Lock rule semantics without HTTP.

**Contract**: Theories/facts covering: PRD long/−0.5% case fires; non-matching trades stay quiet; short-side counterpart if implemented; batch-level rules; deterministic ordering or stable ids across runs.

### Success Criteria:

#### Automated Verification:

- `dotnet test` passes including new coaching rule tests
- `dotnet build TradingTutor.slnx` succeeds with Coaching project referenced

#### Manual Verification:

- None required beyond confirming test output locally if desired

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: LM Studio client + `POST /api/coach/analyze`

### Overview

Orchestrate rules → prompt → LM Studio → combined response behind a coach API endpoint, with config for LM Studio and an optional PDF folder (empty/missing = skip). Mock LLM in tests.

### Changes Required:

#### 1. Config + HttpClient LM Studio adapter

**File**: `backend/TradingTutor.API/appsettings.json`, `appsettings.Development.json`, `Program.cs`, Coaching LLM client

**Intent**: Call a local OpenAI-compatible chat completions API from the server with timeouts aligned to the ~30s NFR.

**Contract**:
- Config section e.g. `Coach` / `LmStudio`: `BaseUrl` (dev default `http://127.0.0.1:1234/v1` or current LM Studio OpenAI path), `Model`, timeout seconds, optional `PdfFolder` path.
- Typed `HttpClient` registered like `IExchangeService` (BaseAddress from config).
- Client sends chat completions with system/head prompt + user payload (findings JSON/text + closed-trade summary); parses assistant text into Verdict + Analysis fields (structured split via prompt instructions or simple section markers — document the chosen contract in code).
- Downstream failures → throw/map to 502 at controller; honor cancellation.

#### 2. Optional PDF folder context

**File**: Coaching prompt/context helper

**Intent**: Honor PRD optional lecture PDFs without blocking Analyze when unset.

**Contract**:
- If `PdfFolder` missing, empty, or unreadable → omit PDF context; Analyze still succeeds when LLM is up.
- If files present → include truncated text extracted from supported files in that folder (keep total prompt bounded). Prefer simple extraction; do not build a vector DB.
- First cut if schedule slips: leave folder support as no-op/empty while keeping the config key.

#### 3. Orchestration + `CoachController`

**File**: `backend/TradingTutor.API/Controllers/CoachController.cs`, Coaching orchestrator, API → Coaching ProjectReference

**Intent**: Single analyze entry point that enforces ≥5, runs rules, calls LLM, returns one success DTO.

**Contract**:
- `POST /api/coach/analyze` body: closed trades array (and any minimal metadata needed).
- Validate: &lt;5 closed trades → 400 Problem; invalid payload → 400.
- On success 200: findings + verdict + analysis (and optionally echo trade count).
- On LLM/upstream failure: 502 Problem **without** findings body (all-or-nothing).
- Logging: request trade count, rule count, duration, failure reason — no need for PII beyond trade stats.

#### 4. Mocked LLM tests

**File**: `tests/TradingTutor.Tests/`

**Intent**: CI-safe coverage of client parsing and orchestration failure/success paths.

**Contract**: Stub `HttpMessageHandler` for LM success and non-OK/timeout-style failures; assert URL/model usage as practical; assert orchestrator/controller mapping does not return findings on LLM failure. No live LM Studio in default test run.

### Success Criteria:

#### Automated Verification:

- `dotnet test` passes including mocked LM / coach tests
- `dotnet build TradingTutor.slnx` succeeds

#### Manual Verification:

- With LM Studio running and a model loaded, `POST /api/coach/analyze` with ≥5 sample trades returns 200 with findings + Verdict/Analysis within ~30s
- With LM Studio stopped, same request returns a clear 502-style Problem (no partial findings)
- With `PdfFolder` unset/empty, success path still works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Diary Analyze UI + gate

### Overview

Wire the diary screen to the coach API: ≥5 enablement, request/response mapping, and a panel below the chart for loading / success / all-or-nothing error + Retry.

### Changes Required:

#### 1. Frontend API client

**File**: `frontend/src/services/api.ts`

**Intent**: Same fetch/`ApiError` pattern as candle load for coach analyze.

**Contract**:
- `fetchCoachAnalyze({ closedTrades, signal? })` → POST `/api/coach/analyze` with JSON body matching backend DTOs.
- Non-OK → `ApiError` from Problem `detail`/`title`.
- Typed success: findings + verdict + analysis strings/fields.

#### 2. Gate helpers + Vitest

**File**: `frontend/src/` pure helper module (e.g. under `diary/` or `coach/`) + `*.test.ts`

**Intent**: Centralize ≥5 enablement and “need N more” copy without coupling to React.

**Contract**:
- Given closed-trade count: `canAnalyze`, `remainingToAnalyze` (max(0, 5 - count)), hint string.
- Vitest covers 0, 4, 5, 6+.

#### 3. Diary coach panel

**File**: `frontend/src/components/DiaryPage.tsx`, `frontend/src/App.css` as needed

**Intent**: Complete US-01 on the existing diary route: chart + AI Verdict/Analysis on demand.

**Contract**:
- Panel below the chart: Analyze button enabled iff `sessionLocked` and `closedTrades.length >= 5`; otherwise disabled with short hint using remaining count.
- Click → loading/spinner state; abort in-flight on unmount if practical.
- Success → show rule findings list + Verdict + Analysis text blocks.
- Failure → error message + Retry (no findings); clearing error on new attempt.
- Do not gate the whole `/diary` route; chart/filters remain available under 5 closes.
- Map SessionProvider `closedTrades` 1:1 into the API payload (no persistence).

### Success Criteria:

#### Automated Verification:

- `npm test` passes including gate/mapping Vitest coverage
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- With &lt;5 closed trades: Analyze disabled + hint; chart still works
- With ≥5 and LM Studio up: Analyze returns Verdict/Analysis in the panel within ~30s perceived wait
- With LM Studio down: error + Retry; no partial findings shown
- Diary ↔ sim navigation still preserves in-memory journal; refresh clears it

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding further.

---

## Testing Strategy

### Unit Tests:

- Fixed rule pack edge cases (PRD long/−0.5%, non-triggers, batch rules)
- LM client response parsing + failure mapping (stubbed HTTP)
- Orchestration: ≥5 validation; no findings leaked on LLM failure
- Frontend ≥5 gate helpers and request field mapping

### Integration Tests:

- Not required as a separate harness this slice; optional manual `.http` sample for `POST /api/coach/analyze` beside existing ByBit sample

### Manual Testing Steps:

1. Run API + frontend; load candles; Play; open/close until ≥5 closed trades; open Diary; Analyze with LM Studio running — confirm findings + Verdict/Analysis under the chart
2. Stop LM Studio; Analyze again — confirm error + Retry, no findings
3. With 3–4 closes — confirm disabled Analyze + hint; chart usable
4. Optional: point `PdfFolder` at a small text/PDF sample and confirm Analyze still returns (or skip if cut)

## Performance Considerations

- Prompt must stay bounded: trades summary + findings + truncated PDF text — no full candle series
- HttpClient timeout ~30s to match NFR; UI spinner should not exceed a hung wait without error
- Solo local use; no caching layer required for MVP

## Migration Notes

Not applicable — no persisted schema. In-memory SessionProvider journal is the only analyze input.

## References

- PRD: `context/foundation/prd.md` — US-01, FR-010, Business Logic, NFR ~30s
- Roadmap: `context/foundation/roadmap.md` — S-05 / Change ID `ai-coach-verdict` (folder is `s-05`)
- Shape preference: `context/foundation/shape-notes.md` — LM Studio forward note
- Prior slice: `context/archive/2026-11-09-s-04/` — diary seams; AI + persistence deferred here
- API pattern: `backend/TradingTutor.API/Controllers/DataController.cs`
- Frontend API: `frontend/src/services/api.ts`
- Diary mount: `frontend/src/components/DiaryPage.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rules engine + coach contracts

#### Automated

- [x] 1.1 `dotnet test` passes including new coaching rule tests
- [x] 1.2 `dotnet build TradingTutor.slnx` succeeds with Coaching project referenced

#### Manual

- [ ] 1.3 Confirm test output locally if desired

### Phase 2: LM Studio client + `POST /api/coach/analyze`

#### Automated

- [x] 2.1 `dotnet test` passes including mocked LM / coach tests
- [x] 2.2 `dotnet build TradingTutor.slnx` succeeds

#### Manual

- [ ] 2.3 With LM Studio running, `POST /api/coach/analyze` with ≥5 trades returns 200 with findings + Verdict/Analysis within ~30s
- [ ] 2.4 With LM Studio stopped, request returns clear 502-style Problem without findings
- [ ] 2.5 With `PdfFolder` unset/empty, success path still works

### Phase 3: Diary Analyze UI + gate

#### Automated

- [x] 3.1 `npm test` passes including gate/mapping Vitest coverage
- [x] 3.2 `npm run typecheck` passes
- [x] 3.3 `npm run lint` passes

#### Manual

- [ ] 3.4 Under 5 closes: Analyze disabled + hint; chart still works
- [ ] 3.5 ≥5 + LM Studio up: panel shows Verdict/Analysis within ~30s
- [ ] 3.6 LM Studio down: error + Retry; no partial findings
- [ ] 3.7 Diary ↔ sim preserves journal; refresh clears it
