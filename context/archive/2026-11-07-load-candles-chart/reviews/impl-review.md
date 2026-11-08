<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Load Candles Chart Implementation Plan

- **Plan**: context/changes/load-candles-chart/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-11-07
- **Verdict**: PASS (findings F1–F8 resolved 2026-11-07)
- **Findings**: 0 critical, 6 warnings, 2 observations — all decisions ACCEPTED / fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (F1 Fix A documented) |
| Scope Discipline | PASS |
| Safety & Quality | PASS (F2–F5, F8 fixed) |
| Architecture | PASS (backend layout accepted) |
| Pattern Consistency | PASS (F6 root slnx only) |
| Success Criteria | PASS (F7 Progress annotated) |

## Automated verification (re-run)

| Check | Result |
|-------|--------|
| `dotnet build` | PASS (0 warnings after OpenApi 2.7.5 pin; NU1903 cleared) |
| `dotnet test` | PASS — 7/7 |
| `npm run build` (frontend/) | PASS |
| `npm run typecheck` | PASS |

## Findings

### F1 — Forbidden multi-project `backend/` solution split

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence
- **Location**: backend/TradingTutor.API/, backend/TradingTutor.Core/, backend/TradingTutor.Trading/, backend/TradingTutor.slnx
- **Detail**: Plan “What We're NOT Doing” explicitly forbids “Moving API under `backend/` or multi-project solution split.” Phase 1 behavior (MarketData fields, ByBit `/v5/market/kline`, `GET /api/data/bybit`, CORS `http://localhost:5173`, no weatherforecast) matches intent, but host/layout were relocated into API + Core + Trading projects under `backend/`. Root `Program.cs` / `Models/` / `Services/` are gone. Phases 2–3 frontend + smoke test MATCH the plan.
- **Fix A ⭐ Recommended**: Document the split as a plan addendum (and align foundation/tech-stack notes) so the new layout is the source of truth going forward.
  - Strength: Preserves working multi-project structure already committed; avoids a costly revert.
  - Tradeoff: Retroactively weakens the original scope guardrail; future plans must treat `backend/` as canonical.
  - Confidence: HIGH — commit history already treats the restructure as intentional (“Restructured project”).
  - Blind spot: Whether thesis/roadmap reviewers expected the single-project shape from the written plan.
- **Fix B**: Revert to a single-project API at repo root as originally planned.
  - Strength: Restores strict plan adherence.
  - Tradeoff: Large mechanical move; breaks paths, VS Code launch/tasks, and mental model already in use.
  - Confidence: MEDIUM — doable but high churn for no functional FR-001 gain.
  - Blind spot: Downstream docs/scripts that already assume `backend/`.
- **Decision**: ACCEPTED Fix A — keep `backend/{API,Core,Trading}`; plan addendum + `tech-stack.md` + plan-brief updated so this layout is canonical. No revert.

### F2 — Broad catch leaks exception text and maps all failures to 502

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend/TradingTutor.API/Controllers/DataController.cs:38-44
- **Detail**: `catch (Exception ex)` returns `Problem(detail: ex.Message, statusCode: 502)`. That (1) exposes raw upstream/parse messages to the browser and (2) treats validation (`ArgumentException` from empty symbol) and cancellation the same as ByBit gateway failures. No server-side log is written on the failure path.
- **Fix**: Map validation → 400, rethrow/`OperationCanceledException`, reserve 502 for exchange/HTTP failures; return a stable public title/detail; log the exception with `ILogger<DataController>`.
  - Strength: Matches common ASP.NET boundary hygiene and stops leaking ByBit/`HttpRequestException` text.
  - Tradeoff: Small controller edit; optional follow-up to global exception middleware later.
  - Confidence: HIGH — localized to one action.
  - Blind spot: Whether the UI currently depends on parsing `detail` text for display (Dashboard uses `error.message` from fetch, which may include Problem details).
- **Decision**: ACCEPTED — validation → 400; `OperationCanceledException` rethrown; exchange failures → 502 with stable public detail; `ILogger` on failure path.

### F3 — Microsoft.OpenApi 2.0.0 NU1903 high-severity advisory

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/TradingTutor.API/TradingTutor.API.csproj (restore/build warning NU1903 / GHSA-v5pm-xwqc-g5wc)
- **Detail**: `dotnet build` reports known high severity vulnerability in `Microsoft.OpenApi` 2.0.0 pulled by the API project. Automated criteria still “pass,” but the advisory is visible on every build.
- **Fix**: Bump OpenAPI-related package(s) to a patched version (or override the transitive package) until NU1903 clears.
- **Decision**: ACCEPTED — pin `Microsoft.OpenApi` 2.7.5 (GHSA-v5pm-xwqc-g5wc patched line).

### F4 — One malformed kline cell fails the entire candle load

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/TradingTutor.Trading/Services/ByBitService.cs:136-150
- **Detail**: Short rows are skipped, but a single bad `ParseInt64` / `ParseDecimal` value throws and surfaces as a full 502, dropping an otherwise usable series.
- **Fix**: Skip/log malformed rows (or try/continue per candle) so one bad cell does not fail the request.
- **Decision**: ACCEPTED — skip/log malformed kline rows; unit test covers keep-valid path.

### F5 — TradingChart throws on bad timestamp inside useEffect

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend/src/components/TradingChart.tsx:104-109
- **Detail**: `toUtcTimestamp` can throw during the candles effect. One bad timestamp can break React’s effect path and leave the series inconsistent, even though the Dashboard keeps prior state on fetch errors.
- **Fix**: Filter/skip invalid timestamps (warn in console) instead of throwing inside the effect.
- **Decision**: ACCEPTED — `tryUtcTimestamp` skips invalid rows with `console.warn`.

### F6 — `backend/TradingTutor.slnx` omits the test project

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend/TradingTutor.slnx:1-5
- **Detail**: Nested backend solution lists API/Core/Trading only. Root `TradingTutor.slnx` includes `tests/TradingTutor.Tests`. Running `dotnet test` against the wrong solution quietly skips the smoke tests that Phase 3 required.
- **Fix**: Add `tests/TradingTutor.Tests` to `backend/TradingTutor.slnx`, or document root `TradingTutor.slnx` as the only supported solution entrypoint and stop dual-maintaining.
- **Decision**: ACCEPTED — removed nested `backend/TradingTutor.slnx`; root `TradingTutor.slnx` is the only entrypoint (tech-stack + plan addendum).

### F7 — Phase 2–3 manual Progress items lack commit-SHA evidence

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/load-candles-chart/plan.md (Progress § Phase 2–3 Manual)
- **Detail**: All manual boxes are `[x]`. Phase 1 appends `— ace458a`; Phase 2–3 manual items (2.3–2.4, 3.3–3.5) have no SHA/evidence note. Automated re-run of build/test/frontend build/typecheck all pass, so criteria are not failing — but rubber-stamping risk remains for E2E chart/error-retain checks.
- **Fix**: Optionally annotate Progress with the commits that landed UI/chart (`f2e016a`, `0bd2a44`) or a short note that manual E2E was confirmed.
- **Decision**: ACCEPTED — Phase 2–3 Progress annotated with `f2e016a` / `0bd2a44` + manual E2E notes.

### F8 — No AbortController / request-generation guard on Load

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/components/Dashboard.tsx:14-36
- **Detail**: Load disables the button while in flight, which reduces races, but overlapping responses can still reorder if that guard changes later. Plan required non-destructive error handling (met) but not abort semantics.
- **Fix**: Abort prior fetch on new submit, or ignore stale responses with a request id — nice-to-have for S-01.
- **Decision**: ACCEPTED — abort prior Load via `AbortController`; ignore abort errors; cleanup on unmount.
