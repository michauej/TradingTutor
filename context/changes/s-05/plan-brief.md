# AI Verdict / Analysis — Plan Brief

> Full plan: `context/changes/s-05/plan.md`

## What & Why

Learners need on-demand coaching after simulated trading. This slice delivers FR-010 / US-01’s AI half: with ≥5 closed trades, Diary Analyze runs fixed logic rules plus a local LM Studio coach and shows Verdict/Analysis the learner can act on.

## Starting Point

S-04 already provides `/diary`, markers, and an in-memory `ClosedTrade` journal in `SessionProvider`. Backend is candles-only (`GET /api/data/bybit`); there is no coach API, LLM client, prompt, PDF config, or Analyze UI.

## Desired End State

From Diary, Analyze is enabled at ≥5 closes. A successful run shows rule findings + Verdict + Analysis under the chart within ~30s when LM Studio is up. Failures are all-or-nothing with Retry. Empty PDF folder still works. Refresh still clears the journal.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| LLM runtime | LM Studio (OpenAI-compatible HTTP) | Matches shape-notes; models swappable without code changes |
| PDF supply | Optional config folder (may be empty) | Keeps PDFs optional; no upload UI |
| Scope | Rules + prompt + LLM on live ≥5 trades | Completes Primary US-01 path |
| Architecture | ASP.NET owns rules + LLM; diary POSTs trades | Config/PDFs stay server-side; matches stack split |
| ≥5 UX | Hard-disable Analyze + “need N more” hint | Matches US-01 Given; diary chart stays open |
| Rule set | Fixed pack of 3–5 rules incl. PRD long/−0.5% | Enough signal without a rules DSL |
| Failures | All-or-nothing error + Retry | Simpler UI; no partial findings on LLM down |
| Persistence | None this slice | Isolates AI risk; live SessionProvider journal only |
| UI | Panel below diary chart | Chart + coach on one US-01 screen |
| LLM context | Trades + findings + optional PDF text | Bounded prompts; no candle dump |
| Tests | Rules + mocked LLM + Vitest gate | CI-safe; live model stays manual |
| Cut first | PDF ingestion | Preserves Primary path if time slips |

## Scope

**In scope:** `TradingTutor.Coaching` + Core DTOs; fixed rules; LM Studio client; `POST /api/coach/analyze`; optional PDF folder; Diary Analyze panel + ≥5 gate; automated tests as above.

**Out of scope:** Persistence; FR-014; browser→LM Studio; streaming; rules DSL; soft gate; partial findings on failure; End Session; folder rename to `ai-coach-verdict`.

## Architecture / Approach

Diary POSTs `closedTrades` to the API. Coaching library evaluates fixed rules, builds a head-prompt payload (findings + trade summary + optional PDF text), calls LM Studio via server `HttpClient`, and returns one success DTO. Controller mirrors `DataController` Problem semantics (400 validation, 502 upstream). Frontend extends `api.ts` and mounts a coach section on `DiaryPage`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Rules + contracts | Coaching project, DTOs, 3–5 rules + xUnit | Rule formulas too naive/noisy |
| 2. LM Studio + API | Analyze endpoint, config, mocked tests, optional PDF | Local model latency/timeouts; prompt split quality |
| 3. Diary UI + gate | Analyze panel, ≥5 hint, Vitest helpers | All-or-nothing UX vs user expectation of “at least rules” |

**Prerequisites:** S-04 diary/journal done; LM Studio install for manual Phase 2/3 checks; Node + `dotnet` toolchains.
**Estimated effort:** ~3–4 sessions across 3 phases (Phase 2 is the heavy skills risk).

## Open Risks & Assumptions

- Change folder `s-05` ≠ roadmap Change ID `ai-coach-verdict` — roadmap auto-status sync will not flip until ids align.
- LM Studio must be running for a full manual demo; app must degrade clearly when it is not.
- PDF extraction quality is best-effort; empty folder is a valid MVP.
- “Saved transactions” means the in-session journal, not disk, for this slice.

## Success Criteria (Summary)

- ≥5 closes → Analyze yields findings + Verdict/Analysis under the diary chart (~30s when LM is up)
- &lt;5 closes → Analyze disabled with hint; diary chart still usable
- LM down → error + Retry with no partial findings; refresh still clears journal
