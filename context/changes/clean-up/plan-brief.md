# Backend Clean-up — Plan Brief

> Full plan: `context/changes/clean-up/plan.md`

## What & Why

Split oversized session and candle orchestration, unify interval mapping, thin coach persistence/LLM boundaries, and add middleware plus OpenTelemetry traces with proper `ILogger` coverage. Goal: maintainable backend structure without changing product HTTP contracts, aside from strict unknown intervals and coach save ownership.

## Starting Point

`SessionService` (~870 lines) mixes lifecycle, trades, advance, and reanchor. `CandleLoadService.LoadAsync` is one linear method. Three interval maps disagree on unknown input. Coach analyze loads/saves sessions and also drives LM. No custom middleware or OTel; session facade has no logger.

## Desired End State

Focused trade/advance/reanchor services behind a thin `SessionService` facade; candle load via internal pipeline steps; one `IntervalParser`; coach analyze is pure over trades with controller persist and a separate LLM helper; API has exception + request logging middleware and traces.

## Key Decisions Made

| Decision | Choice | Why |
| -------- | ------ | --- |
| Scope | All six clean-up items | Full structural + observability pass |
| Order | Interval → session split → candle → coach → OTel | Unblock session math; attack God class early |
| Session API | Thin facade + focused services | Keep controller stable; central lock |
| Behavior | Preserve + tidy | Allow coach persist move + strict intervals |
| Candle pipeline | Internal step types | Testable seams without a framework |
| Interval util | Duration + ByBit in one type | One alias table, two methods |
| Unknown interval | Throw | Stop silent 1h playhead bugs |
| Coach persist | Controller load/save | SRP; analyze stays pure |
| Coach LLM | Extract analyzer service | Cut compound responsibilities |
| OTel | Traces + ILogger (no metrics/log bridge) | Useful observability for app size |
| Middleware | Exception + request logging | Central ProblemDetails + ops visibility |
| Tests | Existing green + targeted new | Lock new contracts |

## Scope

**In scope:** Backend session split, candle steps, interval util, coach SRP + LLM extract, middleware, ILogger gaps, OTel traces, targeted tests.

**Out of scope:** FE interval maps; OTel metrics / logs bridge; service interfaces for session/trade; route or close-mode redesign; Azure session store.

## Architecture / Approach

HTTP controllers keep current routes. `SessionService` delegates mutating commands to `TradeCommandService`, `AdvanceService`, and `IntervalReanchorService` under `SessionCommandLock`. `IntervalParser` feeds session math and ByBit. `CandleLoadService` orchestrates internal steps. `CoachController` + `ISessionRepository` wrap pure `CoachAnalyzeService` / `CoachLlmAnalyzer`. Cross-cutting middleware and OTel wrap the host.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Interval util | Shared parser; throw on unknown | Clients that relied on silent 1h |
| 2. Session split | Facade + three services | Lock/persist regressions |
| 3. Candle steps | Internal pipeline | Fallback/`incomplete` behavior drift |
| 4. Coach SRP + LLM | Pure analyze; controller persist | Persist test move; status codes |
| 5. Observability | Middleware + traces + ILogger | Exception mapping parity |

**Prerequisites:** Runnable API + existing `dotnet test` suite green before start.
**Estimated effort:** ~5 sessions (one phase each), plus manual UI/HTTP checks.

## Open Risks & Assumptions

- Concurrent coach analyze vs session commands still bypasses `SessionCommandLock` (pre-existing).
- OTel package versions for `net10.0` may need a short pin/check at implement time.
- Strict intervals may surface latent bad strings from FE only if any non-chart labels are sent.

## Success Criteria (Summary)

- Session/candle/coach HTTP flows behave as today for valid inputs
- Invalid intervals fail closed; coach still persists via analyze endpoint
- Logs and traces visible for key operations in Development
