# ICT Learning Coach Implementation Plan

## Overview

Extend TradingTutor’s Diary AI coach into an ICT learning surface: selectable hygiene vs ICT rule packs, candle-aware didactic ICT rules that power Bad / Why / Better critique cards, an ICT-oriented LLM prompt with a light cognitive-bias bridge, and toggleable FVG + swing overlays on the diary chart. No lesson-content pack. Dual path: client detects structure for live overlays; server re-detects from the posted candle prefix for authoritative rule / better-zone findings.

## Current State Analysis

- Coach path is live end-to-end: `POST /api/coach/analyze` accepts `{ closedTrades }` only; `FixedRulePack` runs five journal-only hygiene rules; LM Studio returns Verdict/Analysis; Diary renders findings under the chart.
- `ICoachRule.Evaluate` is trades-only by design; no OHLC, no rule-pack selector, no structured “better trade” fields on `RuleFinding`.
- `CoachPromptBuilder.SystemPrompt` is a generic paper-trading coach — no ICT vocabulary, no bias labels.
- Diary has `visibleCandles` and trade markers/spans via shared `TradingChart` (lightweight-charts markers + `LineSeries`). No rectangle/FVG primitives; CryptoTools’ `rectangle-drawing-tool` is the port reference, not present in this repo.
- Roadmap has no `ict-develop` item; this change is a post-MVP thesis/product extension beyond S-05.

## Desired End State

On `/diary`, with a locked session and ≥5 closed trades, the learner can choose **Hygiene** or **ICT** pack, run Analyze, and see:

1. Verdict / Analysis in ICT language (plus light bias bridges where rules map).
2. Critique cards: Bad trade signal → Why (rule) → Better alternative (numeric zone when computable, else qualitative only).
3. Diary chart overlays (toggleable): FVG boxes + swing high/low markers, visible before Analyze from client detection.

Hygiene pack remains available and default-compatible. Unknown `rulePackId` → 400. Candle prefix is required for ICT pack; hygiene may ignore candles. All-or-nothing LLM behavior from S-05 is preserved unless explicitly revisited (not this plan).

### Key Discoveries:

- Analyze assembly point: `DiaryPage.tsx` `runAnalyze` → `fetchCoachAnalyze({ closedTrades })` only — extend here for candles + `rulePackId`.
- `visibleCandles = candles.slice(sessionStartIndex, playhead)` is the correct 8B prefix; 1m windows can be large — Phase 5 must cap/downsample.
- `FixedRulePack` is a hard-coded singleton in `Program.cs`; selectable packs need a registry/factory.
- Chart overlays need a new rectangle primitive + diary builders; swing markers can reuse `SeriesMarker` patterns from `buildTradeMarkers.ts`.

## What We're NOT Doing

- Lesson / curriculum content pack or curated “ICT lesson” PDF courseware (user: no lessons).
- Full automated ICT setup examiner (“this was a valid 2022 model entry”).
- Coding detectors for every kitchen-sink concept (Judas, breaker, multi-model) — those terms may appear via LLM glossary only.
- Server-side candle reload by pack id (8C) — deferred; client posts prefix (8B).
- Multi-timeframe HTF→LTF ICT model as a hard requirement in this change.
- Persistence / session import for ICT scenarios.
- Live exchange orders; strategy backtest UI from CryptoTools.
- Renaming roadmap IDs or closing S-05 archival as part of this change.

## Implementation Approach

1. **Contracts first** — extend analyze request/response and `RuleFinding`; introduce `IRulePack` + registry (`hygiene` | `ict`).
2. **ICT rules + prompt** — candle-aware core rules (liquidity, OB heuristic, FVG interaction, BOS/ChoCH hint, premium/discount); ICT system prompt + short bias bridge map; wider ICT lexicon in prompt only.
3. **Critique UI** — Diary pack selector + Bad/Why/Better cards bound to finding fields.
4. **Overlays** — client `detectFvg` / `detectSwings` → `TradingChart` rectangles + structure markers; document algorithm parity with server helpers used by ICT rules.
5. **Harden** — payload limits, tests, manual LM Studio E2E.

## Critical Implementation Details

- **Candle-aware rules:** Extend the evaluation path so ICT rules receive trades + posted candles (new interface or context object). Do not break hygiene rules that only need trades. Prefer a shared `RuleEvaluationContext` over a breaking change to every `ICoachRule` call site without a migration path.
- **Payload:** Compact candle DTO (ohlc + timestamp; drop redundant symbol/exchange per bar if constant). Cap bar count; if over cap, downsample with a documented policy (e.g. keep bars near trade times + uniform stride) and surface a warning in logs or response metadata if useful.
- **Dual detection:** Server structure helpers used by ICT rules and client detectors must share the same documented definitions (window size for swings, FVG three-candle rule). Fixture tests on both sides with the same sample OHLC JSON.
- **Better zones:** Populate `BetterZone*` only when computable; UI must render qualitative Better text from `message` / a dedicated `alternativeSummary` when zones are null (decision 11B).
- **All-or-nothing:** Keep S-05 behavior — LLM failure returns error without findings — so critique cards only appear on successful Analyze.

## Phase 1: API & rule-pack foundation

### Overview

Extend the analyze contract for `rulePackId` + candle prefix, introduce pack registry with hygiene as the default pack, and enrich `RuleFinding` with optional better-zone / alternative fields. No ICT rule logic or UI yet — hygiene path must keep working.

### Changes Required:

#### 1. Core DTOs

**File**: `backend/TradingTutor.Core/Models/CoachAnalyzeRequest.cs`, `RuleFinding.cs`, new candle input model as needed

**Intent**: Allow clients to select a pack and send the session candle prefix; allow findings to carry structured alternative zones for later critique UI.

**Contract**:
- Request gains `RulePackId` (string, default `"hygiene"`) and optional `Candles` (list of compact OHLC + time).
- `RuleFinding` gains optional fields for alternative/better zone (e.g. `AlternativeSummary`, `BetterZoneLow`/`High`, optional time bounds, optional `BiasLabel`).
- Response may echo `RulePackId` used; keep existing `findings` / `verdict` / `analysis` / `tradeCount`.

#### 2. Rule pack abstraction

**File**: `backend/TradingTutor.Coaching/Rules/FixedRulePack.cs` (refactor), new `IRulePack`, `RulePackRegistry`, `Program.cs`, `CoachAnalyzeService.cs`

**Intent**: Resolve packs by id so ICT can be added without replacing hygiene.

**Contract**: `IRulePack` with `PackId` + evaluate against context (trades, optional candles). Registry maps `"hygiene"` → existing five rules. Unknown id → `ArgumentException` → API 400. Hygiene evaluate ignores missing candles.

#### 3. Frontend API types

**File**: `frontend/src/services/api.ts`, `frontend/src/coach/mapClosedTradesForCoach.ts` (or sibling mapper)

**Intent**: Wire types and body shape for later UI; hygiene calls remain valid with defaults.

**Contract**: `fetchCoachAnalyze` accepts optional `rulePackId` and `candles`; maps `visibleCandles` via a dedicated compact mapper when provided.

### Success Criteria:

#### Automated Verification:

- `dotnet test` — existing coach/rule tests pass; new tests for default hygiene pack, unknown `rulePackId` → 400, finding DTO serialization of optional zone fields
- Frontend `npm run typecheck` passes with updated API types

#### Manual Verification:

- Diary Analyze with no new UI still succeeds (hygiene default) against running API + LM Studio
- Swagger/OpenAPI shows new request fields

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before Phase 2.

---

## Phase 2: ICT didactic rules + prompt

### Overview

Implement the ICT rule pack (coded core concepts) and rewrite the coach system prompt for ICT vocabulary + light bias bridging. Kitchen-sink terms (Judas, breaker, 2022/2024, …) appear only in the prompt glossary, not as detectors.

### Changes Required:

#### 1. Server structure helpers

**File**: new helpers under `backend/TradingTutor.Coaching/Structure/` (or equivalent)

**Intent**: Deterministic swing / FVG / simple range (premium-discount) primitives shared by ICT rules.

**Contract**: Pure functions over posted candles; documented swing lookback and FVG definition; unit-tested with fixed OHLC fixtures. Same definitions as Phase 4 client detectors (document in code comments + one shared fixture file if practical).

#### 2. ICT rule pack

**File**: new rules under `backend/TradingTutor.Coaching/Rules/`, registry registration

**Intent**: Flag didactic mistakes with optional better zones (e.g. long into premium → suggest discount zone).

**Contract**: Pack id `"ict"`. Core coded set covers: liquidity / swing interaction, OB heuristic, FVG interaction, BOS/ChoCH hint, premium/discount. Each finding has stable `Id`, human `Message`, `RelatedTradeIds`, and zone fields when computable. Requires non-empty candles; empty/missing candles → clear 400 validation message.

#### 3. Prompt builder

**File**: `backend/TradingTutor.Coaching/Llm/CoachPromptBuilder.cs`

**Intent**: Coach speaks ICT; lightly maps mistakes to named cognitive biases; instructs `VERDICT:` / `ANALYSIS:` markers; must not invent trades or unverifiable advanced labels as facts.

**Contract**: Distinct system prompt for ICT pack (or prompt mode selected by pack). Include short glossary for advanced terms (LLM-only). Mention bias bridge examples (e.g. FOMO after BOS chase). Hygiene pack keeps a non-ICT prompt (existing or lightly cleaned).

### Success Criteria:

#### Automated Verification:

- `dotnet test` — ICT pack tests with fixtures (premium long, FVG chase, etc.); prompt builder tests assert ICT glossary / bias bridge presence when pack is ICT; hygiene pack regressions green
- Analyze with `rulePackId=ict` + sample candles returns findings including at least one better-zone case in unit/orchestration tests with mocked LLM

#### Manual Verification:

- Live LM Studio Analyze with ICT pack yields Verdict/Analysis that uses ICT terms and does not invent trades
- Hygiene pack Analyze still feels non-ICT / prior behavior

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Critique UI (Diary coach)

### Overview

Add pack selector and Bad / Why / Better critique cards inside the Diary AI coach panel, driven by Analyze findings.

### Changes Required:

#### 1. Pack selector + request wiring

**File**: `frontend/src/components/DiaryPage.tsx`, coach helpers

**Intent**: Learner chooses Hygiene vs ICT before Analyze; ICT sends compact `visibleCandles`.

**Contract**: Selector state (`hygiene` | `ict`); ICT path includes candle mapper; disable Analyze with clear hint if ICT selected but candles empty; preserve ≥5 + `sessionLocked` gate.

#### 2. Critique cards

**File**: `DiaryPage.tsx` (coach success section), CSS in `App.css` as needed

**Intent**: For each finding (or each related trade), show Bad / Why / Better; Better uses zone when present else qualitative text only.

**Contract**: Cards render only on successful Analyze. Selecting a card may optionally highlight related trade markers later; minimum is readable three-part layout. Do not show fabricated prices when zones are null.

#### 3. Frontend finding types

**File**: `frontend/src/services/api.ts`

**Intent**: Mirror optional zone / bias fields from the API.

**Contract**: `CoachRuleFinding` includes optional alternative/zone/bias fields; UI safely handles absence.

### Success Criteria:

#### Automated Verification:

- `npm test` — mapper tests for candle compacting; any pure helpers for critique view-model mapping
- `npm run typecheck` passes

#### Manual Verification:

- Switch Hygiene ↔ ICT; ICT Analyze shows critique cards with at least one qualitative-only Better and one zone-backed Better on a crafted session
- Bias labels appear when backend sets them; absent labels do not break layout
- Error + Retry path unchanged when LM Studio is down

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Chart overlays (FVG + swings)

### Overview

Add toggleable FVG rectangles and swing high/low markers on the Diary chart using client-side detection (dual path), independent of Analyze success.

### Changes Required:

#### 1. Rectangle overlay primitive

**File**: new `frontend/src/plugins/` (slim port of CryptoTools rectangle tool), `TradingChart.tsx`

**Intent**: Draw price/time rectangles for FVG (and optionally better zones later).

**Contract**: Programmatic `add`/`clear` API; `TradingChart` accepts optional `priceRectangles` prop; lifecycle clears/re-adds on change without breaking candles/markers/spans.

#### 2. Client detectors + builders

**File**: new `frontend/src/structure/detectFvg.ts`, `detectSwings.ts`, builders; Vitest fixtures aligned with server definitions

**Intent**: Live structure overlays from `visibleCandles`.

**Contract**: FVG boxes + swing markers; merge markers ascending by time with trade markers; toggles default on for Diary (or when ICT pack selected — product choice: default **on** on Diary with explicit checkboxes).

#### 3. Diary wiring

**File**: `DiaryPage.tsx`

**Intent**: Overlays available while reviewing the session, not only after Analyze.

**Contract**: Checkboxes “Show FVG” / “Show swings”; overlays use `visibleCandles`; Dashboard unchanged unless trivial shared props (default: Diary-only).

### Success Criteria:

#### Automated Verification:

- `npm test` — FVG/swing detector tests against shared fixture OHLC
- `npm run typecheck` passes

#### Manual Verification:

- Diary chart shows FVG boxes and swing markers with toggles; trade markers still correct
- Overlay algorithms visually agree with ICT rule messages on the same session (spot-check)
- No obvious chart performance collapse on ~7d 15m data

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Hardening & verification

### Overview

Enforce candle payload limits, close automated gaps, and run full manual E2E for the ICT learning loop.

### Changes Required:

#### 1. Payload policy

**File**: frontend candle mapper + backend validation in `CoachAnalyzeService` / controller

**Intent**: Prevent MB-sized 1m posts and token blowups.

**Contract**: Documented max bars (choose a concrete limit during implement, e.g. 1500–2000); downsample or reject with clear 400 message; ICT rules still meaningful on downsampled series (prefer preserving bars near trade entry/exit times).

#### 2. Test & docs polish

**File**: tests under `tests/TradingTutor.Tests/`, frontend structure tests, brief comment in `change.md` Notes if needed

**Intent**: Lock dual-path parity and pack switching.

**Contract**: Cross-fixture test or paired fixtures proving server helper vs client detector agreement on swings/FVG for one golden series.

### Success Criteria:

#### Automated Verification:

- `dotnet test` full suite green
- `npm test` and `npm run typecheck` green
- `npm run lint` green (or project-standard lint command)

#### Manual Verification:

- Full loop: load candles → play → ≥5 closes → Diary → ICT pack → overlays visible → Analyze → Verdict/Analysis + critique cards within ~30s with LM Studio up
- Hygiene pack still works on same session
- LM Studio down → error + Retry; no partial critique cards
- Oversized 1m prefix either downsamples successfully or shows a clear validation error (no hang/crash)

**Implementation Note**: After Phase 5, mark change ready for `/10x-impl-review` if desired.

---

## Testing Strategy

### Unit Tests:

- Hygiene registry default + unknown pack id
- ICT rules on fixed OHLC + trade fixtures (PD, FVG, swings)
- `RuleFinding` zone field serialization
- Client `detectFvg` / `detectSwings` vs shared fixtures
- Candle compact mapper + downsample behavior

### Integration Tests:

- `CoachAnalyzeService` with mocked LLM for both packs
- API 400 paths: ICT without candles; unknown pack; over-limit candles policy

### Manual Testing Steps:

1. Hygiene Analyze regression on an existing journal session
2. ICT Analyze with crafted premium-long and FVG-chase trades — confirm Bad/Why/Better
3. Toggle FVG/swings on Diary; confirm markers still snap
4. Kill LM Studio mid-flow — error + Retry
5. Stress a dense 1m prefix for payload policy

## Performance Considerations

- Prefer compact candle DTOs; never dump full `MarketData` fluff per bar.
- Rectangle overlays: clear/re-add on candle window changes; avoid per-frame work.
- Prompt: do not paste full OHLC into the LLM — rules summarize; prompt gets findings + trades (+ glossary), not thousands of bars.

## Migration Notes

- Existing clients omitting `rulePackId` / `candles` keep hygiene behavior.
- No DB migrations (still in-memory session journal).

## References

- Prior feasibility thread: [Investment trainer platform](9607e380-3fc6-44fd-9370-71773244c550)
- Coach baseline: `context/changes/s-05/plan.md`
- CryptoTools rectangle reference: sibling `CryptoTools2.0/frontend/src/plugins/rectangle-drawing-tool.ts`
- CryptoTools swing reference: `InducementStrategy` in CryptoTools 2.0 map
- Key code: `CoachAnalyzeService.cs`, `FixedRulePack.cs`, `CoachPromptBuilder.cs`, `DiaryPage.tsx`, `TradingChart.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API & rule-pack foundation

#### Automated

- [x] 1.1 `dotnet test` — hygiene default, unknown pack → 400, zone field serialization
- [x] 1.2 `npm run typecheck` — updated API types

#### Manual

- [ ] 1.3 Diary Analyze still succeeds with hygiene default + LM Studio
- [ ] 1.4 OpenAPI shows new request fields

### Phase 2: ICT didactic rules + prompt

#### Automated

- [x] 2.1 `dotnet test` — ICT pack fixtures + prompt ICT/bias content + hygiene regressions
- [x] 2.2 Mocked Analyze with `rulePackId=ict` returns findings including a better-zone case

#### Manual

- [ ] 2.3 Live LM Studio ICT Analyze uses ICT terms without inventing trades
- [ ] 2.4 Hygiene pack Analyze remains non-ICT in tone

### Phase 3: Critique UI (Diary coach)

#### Automated

- [x] 3.1 `npm test` — candle mapper / critique view-model helpers
- [x] 3.2 `npm run typecheck`

#### Manual

- [ ] 3.3 Pack switch + critique cards (qualitative and zone-backed Better)
- [ ] 3.4 Bias labels optional without layout break
- [ ] 3.5 LM down → error + Retry unchanged

### Phase 4: Chart overlays (FVG + swings)

#### Automated

- [x] 4.1 `npm test` — FVG/swing detectors vs shared fixtures
- [x] 4.2 `npm run typecheck`

#### Manual

- [ ] 4.3 Toggles show FVG + swings; trade markers intact
- [ ] 4.4 Spot-check overlay vs ICT rule messages on same session
- [ ] 4.5 Acceptable chart performance on ~7d 15m data

### Phase 5: Hardening & verification

#### Automated

- [x] 5.1 `dotnet test` full suite
- [x] 5.2 `npm test` + `npm run typecheck`
- [x] 5.3 `npm run lint`

#### Manual

- [ ] 5.4 Full ICT learning loop E2E with LM Studio (~30s)
- [ ] 5.5 Hygiene pack still works on same session
- [ ] 5.6 LM down → no partial critique cards
- [ ] 5.7 Oversized 1m prefix: downsample or clear 400 — no hang
