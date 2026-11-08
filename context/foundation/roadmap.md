---
project: TradingTutor
version: 1
status: draft
created: 2026-11-07
updated: 2026-11-08
prd_version: 1
main_goal: speed
top_blocker: skills
---


# Roadmap: TradingTutor

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Practicing traders get no coaching signal on what to improve, so bad habits repeat. TradingTutor loads historical candles, runs a simulated session, journals closed trades, and — on demand — returns rule-based findings plus an AI Verdict/Analysis the learner can act on. MVP is solo, simulation-only, no live exchange orders.

## North star

**S-03: User can open and close Long/Short in a playing session on loaded candles** — the north star (the smallest end-to-end slice that proves the core product loop before coaching) lands the sim path the Primary Success Criteria depends on; diary + AI follow immediately and stay in MVP.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| S-01 | load-candles-chart | load historical candles and see them on the sim chart | — | FR-001 | done |
| S-02 | playback-controls | Play / Pause session playback and change speed | S-01 | FR-002, FR-003 | in-progress |
| S-03 | sim-open-close-positions | open Long/Short, close position, see configurable balance | S-02 | FR-004, FR-005, FR-006, FR-007 | proposed |
| S-04 | diary-session-chart | open Trader’s Diary analysis path with session chart + buy/sell markers (no mandatory End) | S-03 | US-01, FR-008, FR-009 | proposed |
| S-05 | ai-coach-verdict | receive AI Verdict / AI Analysis from logic rules + coaching analysis | S-04 | US-01, FR-010 | blocked |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Simulator loop | `S-01` → `S-02` → `S-03` | Speed path: prove play + trade before coach risk |
| B | Diary & coach | `S-04` → `S-05` | Joins Stream A at `S-03`; skills risk concentrated in `S-05` |

## Baseline

What's already in place in the codebase as of `2026-11-07` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** absent — no React/TS companion app yet (planned in tech-stack, not scaffolded by `dotnet new webapi`)
- **Backend / API:** partial — ASP.NET Core Web API starter with sample `/weatherforecast` only (`Program.cs`)
- **Data:** absent — no DB/ORM/migrations; candle/session persistence not started
- **Auth:** absent — per tech-stack / PRD Access Control (single user, no auth)
- **Deploy / infra:** absent — self-host + GitHub Actions named in tech-stack; no workflows/Docker yet
- **Observability:** absent — no logging/metrics/error-tracking wiring beyond framework defaults

## Foundations

No cross-cutting foundations. Companion UI shell, candle storage, and local LLM adapter are introduced inside the first vertical slice that needs them (progressive disclosure under `main_goal: speed`).

## Slices

### S-01: Load candles on chart

- **Outcome:** user can load historical market candles into the simulator (file import or pre-session download) and see them on the chart
- **Change ID:** load-candles-chart
- **PRD refs:** FR-001
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First slice stands up the companion UI + API surface; keep scope to load + render so playback/trading stay unblocked
- **Status:** done

### S-02: Playback controls

- **Outcome:** user can Play / Pause session playback and change playback speed (e.g. 1x / 2x / 5x)
- **Change ID:** playback-controls
- **PRD refs:** FR-002, FR-003
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Depends on a working candle chart; avoid baking trade logic into this slice
- **Status:** in-progress

### S-03: Open and close simulated positions

- **Outcome:** user can open a Long or Short, close the open position, and see simulated account balance with a configurable starting balance (default $10,000)
- **Change ID:** sim-open-close-positions
- **PRD refs:** FR-004, FR-005, FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** North-star completion for the sim loop; closed-trade records here must be enough for diary (`S-04`) without redesign
- **Status:** proposed

### S-04: Trader’s Diary session chart

- **Outcome:** user can open session analysis from the Trader’s Diary / coach path without a mandatory End Session action, and see a diary chart of the session with buy/sell markers
- **Change ID:** diary-session-chart
- **PRD refs:** US-01, FR-008, FR-009
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Advances US-01 chart half; keep AI generation out so skills risk stays isolated in `S-05`
- **Status:** proposed

### S-05: AI Verdict / Analysis

- **Outcome:** user can receive AI Verdict / AI Analysis from fixed logic rules plus coaching analysis on saved transactions (Primary: global analysis with ≥5 closed trades)
- **Change ID:** ai-coach-verdict
- **PRD refs:** US-01, FR-010
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which local LLM runtime and how optional lecture PDFs are supplied for the coaching head prompt? — Owner: user. Block: yes.
- **Risk:** Top blocker (`skills`) lives here; ship rules + prompt contract first, then wire the chosen local model; NFR: usable reply within ~30s
- **Status:** blocked

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| S-01 | load-candles-chart | Load historical candles onto the sim chart | no | Status: planning — plan at `context/changes/load-candles-chart/` |
| S-02 | playback-controls | Play / Pause and playback speed on the chart | no | After S-01 |
| S-03 | sim-open-close-positions | Open/close Long & Short with configurable balance | no | North star; after S-02 |
| S-04 | diary-session-chart | Trader’s Diary session chart with trade markers | no | After S-03 |
| S-05 | ai-coach-verdict | AI Verdict / Analysis from rules + local coach | no | Blocked on local LLM / PDF decision |

## Open Roadmap Questions

1. **Which local LLM runtime will serve FR-010, and how are optional lecture PDFs supplied?** — Owner: user. Block: S-05.

## Parked

- **Live exchange order placement / real money** — Why parked: PRD §Non-Goals; simulation and historical data only.
- **Multi-symbol (FR-011)** — Why parked: nice-to-have; speed bias keeps Primary path first.
- **Multi-timeframe (FR-012)** — Why parked: nice-to-have; first after Primary per PRD.
- **Richer coach context over time (FR-013)** — Why parked: nice-to-have Secondary.
- **Single-transaction analysis after a trade (FR-014)** — Why parked: nice-to-have; global ≥5-trade analysis remains Primary.
- **GitHub Actions / deploy skeleton** — Why parked: self-host on PC for MVP; introduce when a slice needs verification infra.

## Done

- **S-01: user can load historical market candles into the simulator (file import or pre-session download) and see them on the chart** — Archived 2026-11-08 → `context/archive/2026-11-07-load-candles-chart/`. Lesson: —.
