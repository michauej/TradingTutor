---
project: "TradingTutor"
version: 1
status: draft
created: 2026-11-07
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 2
  hard_deadline: 2026-11-20
  after_hours_only: false
---

## Vision & Problem Statement

When practicing or reviewing trading, nothing tells you what to improve in your trading behavior. That missing coaching signal contributes to repeated money losses on the market.

Insight: save a few transactions, analyze them with logic rules plus coaching analysis, and produce a coaching response the learner can act on. Feedback is requested on demand (trader’s journal / AI coach), not forced after every trade. Primary target is solo / handful of users; 100× multi-tenant coach scale is not designed into the MVP domain rule.

## User & Persona

**Primary:** You — solo learner building TradingTutor to improve your own trading skills. You load historical stock/crypto market data, run simulated trading, journal a small set of transactions, and ask the coach for behavior feedback when you choose.

## Success Criteria

### Primary
- First session works end-to-end: open sim UI → Play → open Long or Short → optional speed change → Close Position (≥5 closed trades) → open Trader’s Diary / analysis (no separate End required) → session chart with buy/sell markers and AI Verdict / AI Analysis.

### Secondary
- Richer coach context over time; support for multiple symbols; multi-timeframe view/playback (important follow-on beyond the first proving session).

### Guardrails
- No real money — simulation / historical data only; never place live exchange orders.

## User Stories

### US-01: Open diary and get AI coach feedback

- **Given** a learner in a sim session with at least 5 closed trades
- **When** they open the Trader’s Diary / request analysis (no mandatory End Session)
- **Then** they see a session chart (buy/sell markers) and an AI Verdict / AI Analysis

## Functional Requirements

### Market data & simulator
- FR-001: Learner can load historical market candles into the simulator via file import or a download performed before the session. Priority: must-have
  > Socrates: Counter-argument considered: "Live in-session exchange fetch is unnecessary if coaching only needs candles." Resolution: revised — import from file or download beforehand.
- FR-002: Learner can Play / Pause session playback on the chart. Priority: must-have
  > Socrates: No counter-argument; it stands as written.
- FR-003: Learner can change playback speed (e.g. 1x / 2x / 5x). Priority: must-have
  > Socrates: No counter-argument; it stands as written.
- FR-004: Learner can see simulated account balance with a configurable starting balance (default $10,000). Priority: must-have
  > Socrates: Counter-argument considered: "Starting balance should not be hardcoded." Resolution: revised — configurable starting balance, default $10,000.

### Trading
- FR-005: Learner can open a Long position. Priority: must-have
  > Socrates: No counter-argument; it stands as written.
- FR-006: Learner can open a Short position. Priority: must-have
  > Socrates: No counter-argument; it stands as written.
- FR-007: Learner can close an open position. Priority: must-have
  > Socrates: No counter-argument; it stands as written.

### Session → coach
- FR-008: Learner can open session analysis from the Trader’s Diary / coach without a mandatory separate End Session action. Priority: must-have
  > Socrates: Counter-argument considered: "Analyze should always run without an explicit End." Resolution: revised — no mandatory End Session step; analysis from diary/coach when ready.
- FR-009: Learner can see a diary chart of the session with buy/sell markers. Priority: must-have
  > Socrates: No counter-argument; it stands as written.
- FR-010: Learner can receive AI Verdict / AI Analysis from logic rules plus coaching analysis on saved transactions. Priority: must-have
  > Socrates: No counter-argument; it stands as written.

### After Primary (Secondary)
- FR-011: Learner can use multiple symbols. Priority: nice-to-have
  > Socrates: No counter-argument; it stands as nice-to-have. Note: multi-symbol already exists in CryptoTools 2.0 patterns to reuse.
- FR-012: Learner can use multi-timeframe (first after Primary). Priority: nice-to-have
  > Socrates: No counter-argument; it stands as first-after-Primary nice-to-have.
- FR-013: Learner can get richer coach context over time. Priority: nice-to-have
  > Socrates: No counter-argument; it stands as nice-to-have.
- FR-014: Learner can request analysis of a single closed transaction after a trade. Priority: nice-to-have
  > Socrates: Added after Phase 4 as nice-to-have; global ≥5-trade analysis remains the Primary must-have path (FR-010).

## Non-Functional Requirements

- Coach response feels usable within 30 seconds (learner-perceived time from request to readable Verdict/Analysis).

## Business Logic

TradingTutor scores the learner’s closed trades against fixed logic rules (e.g. after every long, price fell ~0.5%) and returns an AI Verdict/Analysis that combines those rule findings with coaching reasoning driven by a head prompt plus optional context from profitable-trading lecture PDFs.

Inputs: closed trades; optional lecture PDFs; a fixed head prompt; outputs of the applied logic rules. (Learner may also request analysis of a single transaction after a trade.)

Output: analysis/reasoning the learner can read — rule findings plus generated Verdict/Analysis text.

Encounter: after a trade, the learner can optionally ask about that transaction (nice-to-have); with at least five closed trades, they can run a global session analysis from the diary/coach path (Primary).

## Access Control

Single user, single device; no auth; no role separation.

## Non-Goals

- No live exchange order placement / real money — MVP is simulation and historical data only; live trading would change risk, auth, and compliance scope.

## Open Questions

None recorded at generation time. Shape quality cross-check was accepted with no gaps.
