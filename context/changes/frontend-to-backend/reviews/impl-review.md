<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Project-wide (thin-client theory)

- **Plan**: `context/changes/frontend-to-backend/plan.md` (controlling theory); also `rebuild-ui`, `positon-handling`, `s-05`, `s-03`
- **Scope**: Project-wide — completed/automated phases across all active changes
- **Date**: 2026-11-25
- **Verdict**: ACCEPTED (post-triage fixes applied)
- **Findings**: 3 critical / 5 warnings / 2 observations (criticals + F4/F7/F8/F10 addressed)
- **Review policy**: Plan drift allowed when code follows norms and theory. Later plans supersede earlier ones. Drift that breaks server-authoritative trading theory is a fail.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (post-fix) |
| Scope Discipline | PASS |
| Safety & Quality | PASS (post-fix; F5 skipped) |
| Architecture | PASS (post-fix; F7 multi-TF landed) |
| Pattern Consistency | PASS (post-fix) |
| Success Criteria | WARNING (manuals still open — F9) |

## Findings

### F1 — Client OHLC drives advance fills

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: backend/TradingTutor.Trading/Services/SessionService.cs:153-161; frontend/src/session/SessionContext.tsx:508
- **Detail**: Thin-client theory and plan require pack OHLC for money math. When `request.Bars` is non-empty, the server runs `MatchLimits` on client OHLC and skips pack verify. FE always sends bars. This is intentional drift that violates trust-boundary norms.
- **Fix A ⭐ Recommended**: Ignore client bars for money math; always slice OHLC from server packs for the playhead jump.
  - Strength: Matches plan contract and trust-boundary theory; removes forged-OHLC class.
  - Tradeoff: Extra pack load on each advance; need correct range/playhead alignment.
  - Confidence: HIGH — pack load path already exists in the same service.
  - Blind spot: Latency under large jumps not measured.
- **Fix B**: Keep bars as optional cache but verify each bar against pack OHLC (reject on mismatch).
  - Strength: Can keep FE optimization if bars match.
  - Tradeoff: More code; still must load packs to verify.
  - Confidence: MEDIUM — equality rules for floats/timestamps need care.
  - Blind spot: Whether FE bars always match pack bit-for-bit today.
- **Decision**: FIXED via Fix A/E — server packs only for advance fills; FE no longer sends bars; client Bars ignored if present.

### F2 — Client mark price is authoritative for open/close/orders

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: backend/TradingTutor.Trading/Services/SessionService.cs:502-510
- **Detail**: `ResolveMarkAsync` returns any positive client `markPrice`/`markTime` without pack check. Plan requires mark from candle at playhead. FE always sends mark when available, so forged prices can open/close lots.
- **Fix**: Always resolve mark from pack candle at `playhead - 1`; reject or ignore client mark (optional epsilon check only).
  - Strength: Same trust model as F1; one source of price truth.
  - Tradeoff: One pack read per trade command if not cached.
  - Confidence: HIGH — fallback path already loads pack candles.
  - Blind spot: None significant.
- **Decision**: FIXED with F1/E — ResolveMarkAsync always uses pack close; FE no longer sends mark.

### F3 — Session locks do not span HTTP requests

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend/TradingTutor.API/Program.cs:25; backend/TradingTutor.Trading/Services/SessionService.cs:16,457-474
- **Detail**: Plan requires per-session serialization of advance vs trade. `SessionService` is Scoped, so `_locks` is per request. Concurrent advance/open can race on read-modify-write; last write wins and can drop fills/PnL.
- **Fix A ⭐ Recommended**: Move session command locks to a Singleton coordinator (or register a Singleton lock map used by Scoped `SessionService`).
  - Strength: Keeps Scoped service lifetime; fixes cross-request races with small surface.
  - Tradeoff: New small type / DI registration.
  - Confidence: HIGH — classic ASP.NET pattern for keyed gates.
  - Blind spot: Coach analyze still outside SessionService (see F5).
- **Fix B**: Register `SessionService` as Singleton.
  - Strength: Existing `_locks` dictionary starts working across requests.
  - Tradeoff: Lifetime change; must ensure no request-scoped deps leak incorrectly.
  - Confidence: MEDIUM — need to verify injected deps are safe as Singleton.
  - Blind spot: `ICandleLoadService` is Scoped — Singleton SessionService cannot take it directly without a factory/scope.
- **Decision**: FIXED via Fix A — Singleton `SessionCommandLock` shared across Scoped `SessionService` instances.

### F4 — Unbounded client-bar advance jump

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend/TradingTutor.Trading/Services/SessionService.cs:151-197
- **Detail**: Client-bar advance path does not bound `toPlayhead` to pack length. Large fabricated jumps can run a long `MatchLimits` loop. Pack path is safer; FE production path uses bars.
- **Fix**: Cap jump against pack candle count (and optionally a max jump size) after F1 pack authority is restored.
- **Decision**: FIXED with F1/E — advance always uses packs and rejects toPlayhead beyond candle count.

### F5 — Coach analyze races session command writes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend/TradingTutor.Coaching/CoachAnalyzeService.cs:45-58
- **Detail**: Analyze does Get → set coach fields → `CreateSessionAsync` outside SessionService locks. Concurrent trade/advance can overwrite coach writeback or drop trades.
- **Fix**: Persist coach results through SessionService (same session gate) or take the same Singleton session lock before read/write.
- **Decision**: SKIPPED — Analyze is Diary-only; trading is not available in that view, so the race is not a product risk.

### F6 — rebuild-ui table height caps missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend/src/App.css:783-785
- **Detail**: Plan Phase 2 requires `max-height` + `overflow-y: auto` on open/closed trade wraps. `.trades-table-wrap` has `overflow-x: auto` only. Workspace shell and unified close panel are present (close in primary is allowed UX supersession).
- **Fix**: Add `max-height` + `overflow-y: auto` to open-trades and closed-trades wraps in App.css.
- **Decision**: SKIPPED

### F7 — Live interval switch can feed wrong-series bars

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: frontend/src/session/SessionContext.tsx (live TF switch + advance bars)
- **Detail**: Chart interval can change while a locked live session runs. Local candles change; server session interval/pack refs may not. Next advance can send bars from a different series into the old session. Amplifies F1.
- **Fix A ⭐ Recommended**: Block interval switch on locked live sessions until a dedicated server re-anchor command exists.
  - Strength: Small FE guard; stops wrong-series fills immediately.
  - Tradeoff: Learners cannot change TF mid-session until a later feature.
  - Confidence: HIGH — matches current server session model (one interval per session).
  - Blind spot: Whether product wants mid-session TF later.
- **Fix B**: Add server command to update interval/range and re-anchor playhead, then allow switch.
  - Strength: Keeps TF UX if product needs it.
  - Tradeoff: New API + migration of session candle refs; larger change.
  - Confidence: MEDIUM — design not in current plan.
  - Blind spot: How playhead maps across intervals.
- **Decision**: FIXED — Load all TFs + playable list; server `POST …/interval` re-anchor; keep orders; →HTF pause + closed bars ≤T + sim mark, fills only on Play; →LTF no pause; trades visible on all TFs by absolute timestamp; sim watermark never moves backward on TF switch.

### F8 — Blank session id on commands returns HTTP 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend/TradingTutor.API/Controllers/SessionsController.cs (command actions vs GetSession)
- **Detail**: GetSession maps blank id to 400 Problem. Command paths let `ArgumentException` become 500. DataController/CoachController map validation to 400.
- **Fix**: Validate id in controller (or catch `ArgumentException` as 400 Problem) like sibling controllers.
- **Decision**: FIXED — RequireSessionId + ArgumentException → 400 on command routes.

### F9 — Manual success criteria unchecked across changes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: Progress sections in frontend-to-backend, rebuild-ui, s-05 plans
- **Detail**: Automated gates pass (`dotnet` filtered tests 47/47; frontend vitest 63/63; typecheck OK). Many Manual Progress items remain `[ ]` (API smoke, Start→Play→refresh, coach persist, viewport acceptance, LM Studio manual). Risk of rubber-stamped automated-only “done”.
- **Fix**: Run remaining manual smoke lists and check Progress boxes with evidence, or mark deferred explicitly.
- **Decision**: SKIPPED — manuals left open; user deferred during triage.

### F10 — Tests lock in untrusted client-bar advance

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/TradingTutor.Tests/SessionCommandServiceTests.cs (~179-208)
- **Detail**: Test asserts advance with client bars and no pack check. No test rejects forged mark or mismatched OHLC. This encodes F1/F2 as desired behavior.
- **Fix**: Replace with pack-authority tests; add reject/mismatch cases for forged mark/OHLC after F1/F2 fixes.
- **Decision**: FIXED with F1/F2 — pack-authority + forged-mark ignore tests added.

## Cross-change summary

| Change | Status | Review note |
|--------|--------|-------------|
| frontend-to-backend | implementing | Command APIs + coach-by-sessionId; pack authority + locks + F7 re-anchor applied |
| rebuild-ui | implementing | Shell + unified close OK; table caps SKIPPED (F6) |
| positon-handling | implemented | Repo/JSON/entry OK; Save-as-authority correctly superseded |
| s-05 | implementing | Rules/LM/Diary OK; trades-body path correctly superseded by sessionId |
| s-03 | implemented | FE engine correctly superseded by C# PaperTradingEngine |

## Automated verification (2026-11-25)

- `dotnet test --filter PaperTradingEngine|SessionCommand|CoachAnalyze|JsonSession|FixedRule` — PASS (51)
- `frontend`: `npm run test -- --run` — PASS (66)
- `frontend`: `npm run typecheck` — PASS
