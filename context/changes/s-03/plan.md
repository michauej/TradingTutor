# Open and Close Simulated Positions Implementation Plan

## Overview

Implement roadmap S-03 (FR-004–FR-007): on a locked playing session, learners can size with qty or % of wallet, open Long/Short with market or limit orders, pyramid and hedge via hidden lots with net-per-side display, close with market/limit (including many free-form resting limits filled on bar touch), and see a paper account balance (configurable starting balance, default $10,000). Closed-trade records must be diary-ready for S-04; chart buy/sell markers stay out of this slice.

## Current State Analysis

- S-01/S-02 delivered ByBit load + progressive playback: `Dashboard` owns full candles, playhead, speed, and `sessionLocked`; `TradingChart` is presentational and receives only the visible prefix (`frontend/src/components/Dashboard.tsx`, `frontend/src/playback/`).
- Fill/mark price for trading is already implied: last bar of `visibleCandles` (no future peek).
- There are **no** position, balance, order, or trade models/APIs/UI in the repo.
- S-02 deliberately kept trading out of playback; session clock remains client-side with no backend trade engine.
- Roadmap risk: closed-trade records created here must be enough for diary markers (`S-04`) without redesign.
- Change folder id is `s-03`; roadmap **Change ID** for this slice is `sim-open-close-positions` (name mismatch — see References).

## Desired End State

After Load and first Play (session locked), the learner can set (or has set) starting balance, submit market/limit opens on Long or Short using qty or % sizing, hold concurrent long and short exposure (pyramid + hedge), manage many resting limit orders that fill when a newly revealed bar’s high/low touches the limit, close via market (FIFO lot or close-all) or limit, cancel pending limits, and see live paper balance plus net-per-side position summary and a closed-trade list. Chart has no markers yet. Pure trading helpers are Vitest-covered; UI path is manually verified.

### Key Discoveries:

- Mirror `frontend/src/playback/`: extract pure trading/order helpers under something like `frontend/src/trading/` and keep React as orchestration (`Dashboard`).
- Limit matching must run on **playhead advance** when a new bar becomes visible — same tick path as `advancePlayhead` in `Dashboard.tsx` (~lines 67–85).
- Net-per-side UI + FIFO close implies **hidden lots** under the hood (avg entry for display; per-lot journal on close).
- Paper wallet (no cash lock, 1x, no leverage/liquidation) keeps hedge/pyramid tractable; soft notional cap vs balance is the only size guard.
- Markers deferred to S-04; records need side, times, prices, qty, realized PnL (and enough to place buy/sell markers later).

## What We're NOT Doing

- Chart buy/sell markers or diary UI (S-04)
- AI coach / Verdict (S-05)
- Leverage, margin engine, liquidation
- Fees, funding, partial fills
- Backend trade APIs, DB persistence, auth
- Live exchange orders / real money
- Restart / scrubber / file ingest (still parked from S-02)
- Overlay trading chrome on the chart canvas
- Component Testing Library tests for chart DOM

## Implementation Approach

Add a client-side trading module (pure functions + types) for lots, net aggregates, paper balance, market execution, pending limit book, touch-fill on a new `MarketData` bar, FIFO close / close-all, and cancel. `Dashboard` owns trading state beside playback: starting balance (editable until lock), open lots, pending orders, closed trades, realized balance. On each successful playhead +1, pass the newly visible candle into the limit matcher and apply fills before/with the next render. UI: sibling strips for balance + order ticket (side, Market|Limit, Qty|% , limit price) and a pending-orders list with cancel; status shows net Long/Short and balance. `TradingChart` unchanged aside from continuing to receive visible candles only.

## Critical Implementation Details

### Timing & lifecycle

Evaluate resting limits only when the playhead advances and a **new** bar enters the visible prefix (Playing ticks). Do not re-match the same bar on every React render. Session unlock/reset today is page refresh only — any successful Load while unlocked that replaces candles must also clear positions, pending orders, and closed trades together with playback reset. After `sessionLocked`, trading is allowed while Playing **or** Paused (market orders use current last visible close; limits wait for future advances).

### State sequencing

1. Starting balance commits at first Play (lock) — further edits disabled.
2. Market open/close apply immediately at last visible close.
3. Limit orders rest until a later bar touches; at fill time re-check soft notional cap — if exceeded, cancel that order without filling and surface a clear status/error.
4. FIFO market close removes the oldest lot on the chosen side; close-all flattens both sides (all lots) at market.

### User experience spec

Controls stay off-canvas as sibling strips (`.load-form` / `.playback-controls` pattern in `App.css`). Order ticket supports Long/Short × Market/Limit × Qty/%. Pending list shows all free-form limits with cancel. Net position line shows per-side qty + average entry; balance shows starting + realized (paper).

## Phase 1: Trading engine + Vitest

### Overview

Introduce pure domain types and helpers for sizing, lots/net sides, paper balance, market open/close (FIFO + close-all), multi-order limit book, touch-fill on a bar, and cancel — with Vitest coverage and no UI yet.

### Changes Required:

#### 1. Trading domain module

**File**: `frontend/src/trading/` (new module; exact filenames left to implementer)

**Intent**: Own all sim trading math/state transitions so Dashboard and tests share one contract; keep leverage hooks out (1x only) but structure size/PnL so leverage can be added later without redesigning lots/orders.

**Contract**:
- **Types (minimum):** side `long | short`; lot `{ id, side, qty, entryPrice, entryTime }`; net side aggregate `{ qty, avgEntry }`; order `{ id, side, intent: 'open' | 'close', type: 'market' | 'limit', qty, limitPrice?, createdAt }`; closed trade `{ id, side, qty, entryPrice, entryTime, exitPrice, exitTime, realizedPnl }`; account `{ startingBalance, realizedPnl }` with `balance = startingBalance + realizedPnl`.
- **Sizing:** `qtyFromPercent(balance, percent, markPrice)` and accept raw qty; reject non-positive qty/percent; soft cap: order notional `qty * markPrice` must be `<= balance` (paper rule) at submit.
- **Open market:** append a lot at `markPrice` / `markTime`; update net aggregate for that side.
- **Close market FIFO:** close oldest lot on side (full lot); push closed trade; update realized PnL; optional close-all flattens every lot on both sides.
- **Limits:** append to book (many allowed); `cancelOrder(id)`; `matchLimits(orders, lots, bar)` using touch rules — open long if `bar.low <= limit`, open short if `bar.high >= limit`, close long if `bar.high >= limit`, close short if `bar.low <= limit`; fill price = limit; full qty only (no partials). At fill, re-validate soft cap for opens; on failure remove/cancel order with a typed reason.
- **PnL:** long `(exit - entry) * qty`; short `(entry - exit) * qty`.
- **Display helpers:** net Long / net Short from lots (sum qty, qty-weighted avg entry).

#### 2. Vitest for trading helpers

**File**: `frontend/src/trading/*.test.ts` (and barrel export as needed)

**Intent**: Lock fill/FIFO/cap/pyramid-hedge behavior without a UI harness.

**Contract**: `npm test` covers at least: qty/% sizing + soft cap reject; market open pyramid (two longs) and hedge (long+short); FIFO close order; close-all; limit open/close touch on high/low (including wick touch, no fill when not touched); multi-order book cancel; fill @ limit price; closed-trade PnL sign for long/short; soft-cap failure at fill cancels without mutating lots.

### Success Criteria:

#### Automated Verification:

- `npm test` passes including new trading helper tests
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None required beyond confirming test run output locally if desired

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Dashboard session wiring

### Overview

Bind trading state to the existing session lifecycle: starting balance until lock, mark price from visible candles, market execution from UI actions (wired thinly), and limit matching on each playhead advance.

### Changes Required:

#### 1. Session-owned trading state

**File**: `frontend/src/components/Dashboard.tsx`

**Intent**: Keep trading beside playback in the session owner; reset trading state whenever an unlocked Load successfully replaces the series; freeze starting-balance edits at first Play together with existing `sessionLocked`.

**Contract**:
- State: `startingBalance` (default `10000`), lots, pending orders, closed trades, realized PnL (or derive from closed trades — one source of truth).
- `balance` displayed = starting + realized.
- Trading actions no-op or error clearly if `!sessionLocked` or no mark candle (`visibleCandles.length === 0`).
- On locked session: allow market/limit submit while Playing or Paused.
- On playhead advance that reveals a new bar: call `matchLimits` with that bar; apply resulting lot/trade/order updates in one state transition.
- Failed Load while locked remains non-destructive (existing S-01/S-02 rule) and must not clear trading state.

#### 2. Mark price helper usage

**File**: `frontend/src/trading/` and/or `Dashboard.tsx`

**Intent**: Single definition of mark/fill time for market orders.

**Contract**: Market fills use last visible candle `close` and `timestamp`. Limit matching uses the full OHLC of the newly revealed bar only.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- (Dev-only / temporary hooks acceptable) Advancing playhead fills a resting limit when the new bar wicks through the price and leaves it resting when it does not
- Starting balance becomes non-editable after first Play; refresh still clears the in-memory session

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Trade UI + closed-trade surface

### Overview

Ship the learner-facing controls and readouts: configurable balance, order ticket (market/limit, qty/%, long/short), close market (FIFO + close all) and limit-under-close, pending-orders list with cancel, net positions, paper balance, and closed-trade list — no chart markers.

### Changes Required:

#### 1. Balance + trade control strips

**File**: `frontend/src/components/Dashboard.tsx`, `frontend/src/App.css`

**Intent**: Follow sibling-strip layout under load/playback controls; keep `TradingChart` free of trading chrome.

**Contract**:
- Starting balance input (default 10000), disabled when `sessionLocked`.
- Live balance readout.
- Order ticket: side Long/Short; type Market/Limit; sizing mode Qty | %; qty or percent field; limit price when type=Limit; submit open.
- Close controls: market close FIFO (per side or clear default side UX left to implementer as long as FIFO-per-side exists), Close all, and limit close entry (side + price + qty) that adds a resting close order.
- Pending orders list: all resting limits with cancel.
- Net Long / net Short summary (qty + avg entry).
- Disable or explain actions when flat / no mark price / unlocked.

#### 2. Closed-trade list (diary-ready)

**File**: `frontend/src/components/Dashboard.tsx` (or small presentational child if cleaner)

**Intent**: Persist enough in-memory closed trades for S-04 markers without building diary/chart markers now.

**Contract**: Render a simple list/table of closed trades with side, qty, entry/exit price, entry/exit time, realized PnL. Shape must match Phase 1 closed-trade type. No Lightweight Charts markers in this phase.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- `npm run typecheck` passes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Set starting balance → Play → open market Long by qty and by % → see balance/net update
- Open Short while Long open (hedge); open second Long (pyramid); net averages look right
- Place multiple limit opens/closes; on Play, orders fill on wick touch @ limit; cancel removes a resting order
- Market FIFO close and Close all produce closed-trade rows with correct PnL sign
- Chart still has no buy/sell markers; playback/load lock behavior unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before treating the change as complete.

---

## Testing Strategy

### Unit Tests:

- Sizing (qty/%), soft cap at submit and at limit fill
- Pyramid + hedge lot sets → net aggregates
- Market FIFO close ordering; close-all
- Limit touch matrix (open/close × long/short × high/low)
- Cancel; multi-order book; PnL signs

### Integration Tests:

- None required beyond Dashboard manual E2E (no new backend)

### Manual Testing Steps:

1. Load candles → set balance ≠ 10000 → Play → confirm balance locked
2. Market open Long (qty) and Long (%); confirm notional soft-cap rejection when oversized
3. Hedge with Short; pyramid second Long; inspect net lines
4. Add several limit orders; Play through bars; confirm fills/cancels
5. FIFO close and Close all; inspect closed-trade list
6. Pause mid-session; market order still works; limits only progress on Play advances
7. Confirm chart has no markers and transport still auto-pauses at end

## Performance Considerations

Limit matching runs once per playhead tick over a small in-memory order list — fine for MVP. Do not scan the full candle history each tick. Keep chart on incremental `update` path from S-02.

## Migration Notes

No DB. In-memory only; refresh clears session (same as S-02). No API migrations.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03; Change ID `sim-open-close-positions`)
- PRD: FR-004–FR-007 in `context/foundation/prd.md`
- Prior playback plan: `context/archive/2026-11-08-playback-controls/plan.md`
- Session owner: `frontend/src/components/Dashboard.tsx`
- Playback helpers pattern: `frontend/src/playback/`
- Note: this change folder is `s-03`; roadmap status sync expects Change ID `sim-open-close-positions` — align ids in a follow-up if automated roadmap flips are desired

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Trading engine + Vitest

#### Automated

- [x] 1.1 `npm test` passes including new trading helper tests
- [x] 1.2 `npm run typecheck` passes
- [x] 1.3 `npm run lint` passes

#### Manual

- [x] 1.4 None required beyond confirming test run output locally if desired

### Phase 2: Dashboard session wiring

#### Automated

- [x] 2.1 `npm test` passes
- [x] 2.2 `npm run typecheck` passes
- [x] 2.3 `npm run lint` passes

#### Manual

- [x] 2.4 Advancing playhead fills a resting limit when the new bar wicks through the price and leaves it resting when it does not
- [x] 2.5 Starting balance becomes non-editable after first Play; refresh still clears the in-memory session

### Phase 3: Trade UI + closed-trade surface

#### Automated

- [x] 3.1 `npm test` passes
- [x] 3.2 `npm run typecheck` passes
- [x] 3.3 `npm run lint` passes
- [x] 3.4 `npm run build` passes

#### Manual

- [x] 3.5 Set starting balance → Play → open market Long by qty and by % → see balance/net update
- [x] 3.6 Open Short while Long open (hedge); open second Long (pyramid); net averages look right
- [x] 3.7 Place multiple limit orders; on Play, orders fill on wick touch @ limit; cancel removes a resting order
- [x] 3.8 Market FIFO close and Close all produce closed-trade rows with correct PnL sign
- [x] 3.9 Chart still has no buy/sell markers; playback/load lock behavior unchanged
