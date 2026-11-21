# ICT Learning Coach — Plan Brief

> Full plan: `context/changes/ict-develop/plan.md`

## What & Why

Turn the existing Diary AI coach into an ICT learning surface: practice on historical candles, then get Bad / Why / Better critique plus ICT-language coaching (with a light cognitive-bias bridge). Goal is teachable, defensible feedback — not an automated “valid ICT setup” examiner.

## Starting Point

S-05-style coach is already live: hygiene `FixedRulePack`, LM Studio Analyze, Diary findings panel. Rules are journal-only; prompt is generic; chart has trade markers/spans but no FVG/swing overlays. `visibleCandles` exist client-side and are not sent to Analyze today.

## Desired End State

On Diary, learner picks Hygiene or ICT, sees toggleable FVG + swing overlays, runs Analyze (≥5 closes), and gets Verdict/Analysis in ICT terms plus critique cards. Better alternatives show numeric zones when rules can compute them, otherwise qualitative guidance only.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| Product shape | Coach + rules + overlays; no lesson pack | Full learning loop without curriculum authoring |
| Critique UX | Diary AI coach Bad/Why/Better cards | Matches “bad trade vs potential good” teaching view |
| Alternatives | Rule sketch + LLM prose | Thesis-defensible deterministic signal |
| Concept breadth | Coded core + LLM glossary for kitchen-sink terms | Bounds engineering while keeping rich vocabulary |
| Candles | Client posts session prefix (8B) | Same series the learner traded on |
| Structure path | Dual: client overlays + server re-detect for rules | Live visuals before Analyze; authoritative critique |
| Overlays | FVG + swings | Two complementary visuals without full OB geometry |
| Packs | Selectable hygiene vs ICT | Preserves existing coach; ICT is opt-in |
| Missing zones | Qualitative Better only | No fake prices |
| Cut policy | Ship all layers (no deliberate cuts) | User priority: complete ICT learning slice |

## Scope

**In scope:** Pack registry; candle prefix on analyze; ICT core rules + prompt/bias bridge; critique cards; Diary FVG/swing overlays; payload caps; tests + E2E.

**Out of scope:** Lesson packs; full ICT auto-grader; coded Judas/breaker/multi-model detectors; 8C server pack reload; multi-TF as hard gate; persistence/import; CryptoTools backtest UI.

## Architecture / Approach

Diary POSTs `{ closedTrades, rulePackId, candles? }`. Registry runs hygiene or ICT pack; ICT uses server structure helpers on posted OHLC to emit findings with optional better zones; LLM gets ICT prompt + findings/trades (not raw bar dumps). Client independently detects FVG/swings for chart overlays via a rectangle primitive + markers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. API & packs | Contracts, registry, zone fields | Breaking hygiene default |
| 2. ICT rules + prompt | Core rules, ICT/bias prompt | Noisy heuristics / definition fights |
| 3. Critique UI | Selector + Bad/Why/Better cards | Dense Diary UX |
| 4. Overlays | FVG boxes + swing markers | Dual-path drift; chart perf |
| 5. Harden | Payload caps + full E2E | 1m series size; LM latency |

**Prerequisites:** Working Diary + coach (LM Studio for manual); Node + `dotnet` toolchains.
**Estimated effort:** ~5–7 sessions across 5 phases (Phase 2 and 4 are heaviest).

## Open Risks & Assumptions

- ICT definitions must be frozen in code/thesis text; community definitions vary.
- Dual detectors can drift without shared fixtures.
- `12D` (no cuts) raises schedule risk — phases stay shippable independently if forced to pause.
- Not on `roadmap.md` — no roadmap status sync for this change-id.

## Success Criteria (Summary)

- ICT Analyze yields ICT-language coaching + critique cards with honest Better blocks
- Diary shows toggleable FVG + swings aligned with rule definitions
- Hygiene pack remains selectable and functional
- Large candle prefixes are capped/downsampled or clearly rejected; LM failures stay all-or-nothing
