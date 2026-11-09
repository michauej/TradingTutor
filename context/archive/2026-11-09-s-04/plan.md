# Trader’s Diary Session Chart Implementation Plan

## Overview

Implement roadmap S-04 (FR-008, FR-009 / US-01 chart half): learners can open a dedicated Trader’s Diary route without a mandatory End Session action and see a session chart of the revealed candle prefix with economic buy/sell markers for closed trades and open-lot entries. AI Verdict stays in S-05; persistence stays out.

## Current State Analysis

- S-03 journals diary-ready `ClosedTrade` and open `Lot` records in `Dashboard` React state (`frontend/src/trading/types.ts`, `Dashboard.tsx`) with `entryTime` / `exitTime` copied from candle `timestamp` strings.
- `TradingChart` is presentational candles-only (`frontend/src/components/TradingChart.tsx`); `lightweight-charts` ^5.2.1 supports markers via `createSeriesMarkers(series).setMarkers(...)`.
- `App.tsx` renders only `Dashboard`; no router, no shared session context. Live chart receives `visibleCandles = candles.slice(sessionStartIndex, playhead)`.
- No End Session control exists — FR-008 is “add diary entry,” not “remove End.”
- Change folder id is `s-04`; roadmap **Change ID** for this slice is `diary-session-chart` (name mismatch — see References).

## Desired End State

After session lock (first Play), the learner can navigate to `/diary` at any time (0+ closed trades). The diary screen shows the revealed session prefix with buy/sell markers: closed-trade entry/exit mapped economically (long open=buy, long close=sell, short open=sell, short close=buy) plus entry markers for still-open lots. Sim `/` chart stays marker-free. Playback pauses when entering diary. Refresh still clears in-memory session. Pure marker mapper is Vitest-covered; route + chart path is manually verified.

### Key Discoveries:

- Marker times must use the same `Date.parse` → floor-seconds `UTCTimestamp` path as `TradingChart.tryUtcTimestamp` (`TradingChart.tsx` ~162–167) so markers land on bars.
- v5 API is `createSeriesMarkers`, not legacy series `setMarkers`.
- Dedicated `/diary` requires lifting session/trading state above routes or navigation remounts wipe the journal.
- Multiple closed rows can share one `exitTime` (FIFO / close-all) — several markers at one bar time is expected.

## What We're NOT Doing

- AI Verdict / Analysis / logic rules (S-05)
- localStorage or backend persistence of sessions/trades
- Mandatory End Session control
- Gating diary on ≥5 closed trades (S-05 may gate AI; diary is anytime after lock)
- Markers on the live sim chart while trading
- Peeking unrevealed candles on the diary chart
- Live exchange orders / real money
- Component Testing Library / DOM tests for the chart canvas
- Renaming the change folder to `diary-session-chart` (document mismatch only)

## Implementation Approach

1. Add a pure marker builder under `frontend/src/` (e.g. `frontend/src/diary/` or beside chart helpers) that maps `ClosedTrade[]` + open `Lot[]` + revealed `MarketData[]` into `SeriesMarker<UTCTimestamp>[]`, filtering to times present on the revealed series.
2. Extend `TradingChart` with an optional markers prop; attach `createSeriesMarkers` in the chart lifecycle and call `setMarkers` whenever candles/markers change; Dashboard continues to pass no markers.
3. Introduce `react-router-dom` and a `SessionProvider` that owns the session/trading state currently local to `Dashboard`. Routes: `/` → sim Dashboard; `/diary` → diary view with marked chart, legend, back link. CTA to diary enabled when `sessionLocked`; navigating to diary pauses playback.

## Critical Implementation Details

### Timing & lifecycle

Pause playback when entering `/diary` so the revealed prefix and markers stay stable during review. Do not advance the playhead while the diary route is mounted. Returning to `/` resumes only if the user presses Play again (do not auto-resume).

### State sequencing

SessionProvider must own at least: `candles`, `sessionStartDate` / `sessionStartIndex` inputs, `playhead`, `playing`, `speed`, `sessionLocked`, `lots`, `pendingOrders`, `closedTrades`, `realizedPnl`, `startingBalance`, and load/reset helpers used by Dashboard. Ticket form local UI state may remain in Dashboard. Successful unlocked Load must still clear trading + playback together.

## Phase 1: Marker mapper + Vitest

### Overview

Ship a pure, testable mapping from closed trades and open lots to economic buy/sell markers scoped to the revealed candle prefix.

### Changes Required:

#### 1. Marker builder module

**File**: `frontend/src/diary/` (or equivalent pure module + barrel)

**Intent**: Centralize buy/sell marker construction so chart and tests share one contract without mounting Lightweight Charts.

**Contract**:
- Input: `closedTrades: ClosedTrade[]`, `openLots: Lot[]`, `visibleCandles: MarketData[]` (revealed prefix).
- Output: `SeriesMarker<UTCTimestamp>[]` (or a thin local marker DTO that `TradingChart` accepts 1:1).
- Economic mapping:
  - Long entry (closed entry or open lot): buy → `arrowUp`, `belowBar`, distinct buy color
  - Long exit: sell → `arrowDown`, `aboveBar`, distinct sell color
  - Short entry (closed entry or open lot): sell → `arrowDown`, `aboveBar`, sell color
  - Short exit: buy → `arrowUp`, `belowBar`, buy color
- Drop markers whose timestamp does not parse or does not match a bar time in `visibleCandles` (same second resolution as the chart).
- Stable optional `id` / short `text` for debugging (e.g. B/S) is fine; keep labels minimal.
- Export shared `toUtcTimestamp` (or reuse extracted helper) rather than duplicating parse logic ad hoc in the chart later.

#### 2. Vitest coverage

**File**: `frontend/src/diary/*.test.ts` (path aligned with module)

**Intent**: Lock marker semantics and filtering without a UI harness.

**Contract**: `npm test` covers at least: long round-trip → buy then sell; short round-trip → sell then buy; open long/short lot → entry marker only; markers outside visible prefix filtered out; unparseable times skipped; multiple closes at same `exitTime` all emit markers.

### Success Criteria:

#### Automated Verification:

- `npm test` passes including new diary marker mapper tests
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None required beyond confirming test run output locally if desired

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: TradingChart markers prop

### Overview

Teach `TradingChart` to render an optional marker list via the v5 series markers plugin while keeping the sim chart marker-free.

### Changes Required:

#### 1. Optional markers on TradingChart

**File**: `frontend/src/components/TradingChart.tsx`

**Intent**: Keep the chart presentational; accept markers as data, not trading domain objects.

**Contract**:
- Extend props: `candles: MarketData[]` plus optional `markers?: SeriesMarker<UTCTimestamp>[]` (default empty / omitted).
- On series create: `createSeriesMarkers(series)`; store plugin ref; `detach()` on unmount.
- After candle `setData` / incremental `update` paths: `setMarkers(markers ?? [])`.
- Empty markers clears prior markers.
- Dashboard continues `<TradingChart candles={visibleCandles} />` with no markers prop.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run lint` passes
- Phase 1 `npm test` still passes

#### Manual Verification:

- Temporary manual smoke allowed (pass a hard-coded marker in a throwaway branch) is optional; prefer verifying markers with Phase 3 diary route
- Sim chart with no markers prop still looks unchanged (no stray markers)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: SessionProvider + routes + Diary UI

### Overview

Lift shared session/trading state, add `/` and `/diary` routes, and ship the Trader’s Diary screen with marked session chart, legend, and navigation — no End Session, no persistence, no AI.

### Changes Required:

#### 1. Dependency + router shell

**File**: `frontend/package.json`, `frontend/src/App.tsx`, `frontend/src/main.tsx` as needed

**Intent**: Dedicated diary URL without losing in-memory session on navigation.

**Contract**: Add `react-router-dom`. `BrowserRouter` (or equivalent) wraps a `SessionProvider`. Routes: `/` → sim Dashboard; `/diary` → diary page. Unknown paths can redirect to `/`.

#### 2. SessionProvider state lift

**File**: new provider module under `frontend/src/` + refactor `Dashboard.tsx`

**Intent**: Single in-memory source of truth for session + trading so diary and sim share candles, playhead, lots, and closed trades.

**Contract**:
- Move session/trading state and playback/load/trading mutations that both screens need into the provider (or a hook used only by the provider).
- Dashboard consumes context; behavior of Load / Play / Pause / speed / trading / lock / reset must match S-03.
- `visibleCandles` remains `slice(sessionStartIndex, playhead)`.
- In-memory only — no localStorage.

#### 3. Diary page + navigation

**File**: new diary page/component; Dashboard CTA; shared CSS in `App.css` / `index.css` as needed

**Intent**: FR-008/FR-009 learner path: open analysis when ready; see session chart with buy/sell markers.

**Contract**:
- CTA (e.g. “Open Trader’s Diary”) enabled when `sessionLocked`; disabled or hidden before lock with clear affordance.
- Navigating to `/diary` sets `playing` to false (pause); do not auto-resume on return.
- Diary shows `TradingChart` with `visibleCandles` and `markers={buildTradeMarkers(...)}` using closed trades + open lots.
- Short legend explaining buy vs sell colors/shapes; list or empty state for zero closed trades / zero open lots is OK.
- Back control to `/` (sim).
- No AI panel; no End Session button; no ≥5 gate.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- `npm run typecheck` passes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Lock a session, trade (including at least one open lot and one closed round-trip long and short if practical), open diary via CTA → URL `/diary`, playback paused
- Diary chart shows revealed prefix only; buy/sell markers match economic mapping; open-lot entries appear; legend readable
- Return to `/`, press Play — session state intact (balance, lots, closed trades); sim chart still has no markers
- Before first Play, diary CTA not usable; refreshing the app clears session (in-memory)
- No End Session control introduced

**Implementation Note**: After completing this phase and all automated + manual verification passes, the change is ready for `/10x-impl-review` / archive per team workflow.

---

## Testing Strategy

### Unit Tests:

- Economic buy/sell mapping for long and short closed trades
- Open-lot entry markers only
- Filter to revealed prefix / invalid timestamps
- Duplicate exit times still produce multiple markers

### Integration Tests:

- None required for MVP; router + provider covered by manual path

### Manual Testing Steps:

1. Load candles → Play (lock) → open diary with zero closes → empty/sparse markers OK, chart shows revealed bars
2. Open long, leave open → diary shows buy entry for open lot
3. Close long → diary shows buy entry + sell exit
4. Short open/close → sell entry + buy exit
5. Confirm sim chart never shows markers; diary pauses playback; refresh clears state

## Performance Considerations

Marker lists are small (handful of trades per session, ≤1000 bars). Rebuild markers on diary render / context change only; no need for virtualization.

## Migration Notes

Not applicable — no persisted schema. Existing in-memory S-03 sessions are the only data source.

## References

- Roadmap: `context/foundation/roadmap.md` — S-04 outcome; Change ID `diary-session-chart` (folder is `s-04`)
- PRD: `context/foundation/prd.md` — US-01, FR-008, FR-009
- Prior slice: `context/changes/s-03/plan.md` — closed-trade contract; markers deferred here
- Chart: `frontend/src/components/TradingChart.tsx`
- Types: `frontend/src/trading/types.ts` — `ClosedTrade`, `Lot`
- Library: `lightweight-charts` `createSeriesMarkers` / `SeriesMarker`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Marker mapper + Vitest

#### Automated

- [x] 1.1 `npm test` passes including new diary marker mapper tests
- [x] 1.2 `npm run typecheck` passes
- [x] 1.3 `npm run lint` passes

#### Manual

- [x] 1.4 None required beyond confirming test run output locally if desired

### Phase 2: TradingChart markers prop

#### Automated

- [x] 2.1 `npm run typecheck` passes
- [x] 2.2 `npm run lint` passes
- [x] 2.3 Phase 1 `npm test` still passes

#### Manual

- [ ] 2.4 Temporary manual smoke allowed (pass a hard-coded marker in a throwaway branch) is optional; prefer verifying markers with Phase 3 diary route
- [x] 2.5 Sim chart with no markers prop still looks unchanged (no stray markers)

### Phase 3: SessionProvider + routes + Diary UI

#### Automated

- [x] 3.1 `npm test` passes
- [x] 3.2 `npm run typecheck` passes
- [x] 3.3 `npm run lint` passes
- [x] 3.4 `npm run build` passes

#### Manual

- [ ] 3.5 Lock a session, trade (including at least one open lot and one closed round-trip long and short if practical), open diary via CTA → URL `/diary`, playback paused
- [ ] 3.6 Diary chart shows revealed prefix only; buy/sell markers match economic mapping; open-lot entries appear; legend readable
- [ ] 3.7 Return to `/`, press Play — session state intact (balance, lots, closed trades); sim chart still has no markers
- [ ] 3.8 Before first Play, diary CTA not usable; refreshing the app clears session (in-memory)
- [ ] 3.9 No End Session control introduced
