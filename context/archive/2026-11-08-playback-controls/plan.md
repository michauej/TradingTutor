# Playback Controls Implementation Plan

## Overview

Implement roadmap S-02 (FR-002, FR-003): learners can Play / Pause session playback and change wall-clock speed (1x / 2x / 5x) on the sim chart. Playback uses progressive candle reveal from a chosen session start date, with a ≥300-candle warm-up, auto-pause at the true end of the loaded series, and Load locked after the first Play. Full-file candle ingest remains a follow-on change; ByBit stays the temporary dataset source (practical max 1000 bars).

## Current State Analysis

- S-01 delivered pre-session ByBit download + full-series chart render (`Dashboard` → `TradingChart`).
- `Dashboard` holds the entire candle array in React state and always passes it through; there is no playhead, timer, or transport UI.
- `TradingChart` maps all props candles to `series.setData` and calls `fitContent()` on every change — unsafe for per-tick progressive reveal (resets viewport every advance).
- Fetch default `limit` is 200 end-to-end; `ByBitService` clamps to 1–1000 on a single kline request (no pagination). Warm-up ≥300 requires raising the practical load toward 1000.
- No frontend test runner; backend has xUnit smoke only. S-01 verification style: `npm` typecheck/build + manual E2E.
- Roadmap risk for S-02: do not bake trade logic into this slice (S-03 depends on a playing session).

## Desired End State

After Load, the learner picks a session start date within the loaded series, sees ≥300 warm-up candles from that start (clamped to series end), and can Play / Pause with 1x / 2x / 5x wall-clock advances that append candles until the last bar, then auto-pause. Load is disabled after the first Play. Chart does not peek future bars. Pure playhead/speed helpers are covered by Vitest; chart transport is verified manually.

### Key Discoveries:

- Full series must stay in Dashboard memory; only a visible prefix (or equivalent playhead) feeds the chart (`frontend/src/components/Dashboard.tsx`).
- Unconditional `fitContent` on every candles change in `TradingChart.tsx` must be limited to load/reset — tick advances should use incremental series update / controlled `setData` without refitting.
- ByBit hard max remains 1000 until file ingest; “all candles, no artificial end” is honored as “play to last loaded candle,” not unlimited exchange history.
- Control layout should mirror `.load-form` as a sibling strip under the load form (`frontend/src/App.css`), keeping `TradingChart` presentational.

## What We're NOT Doing

- File-based candle ingest / immutable file dataset (follow-on; design assumes a fixed in-memory series)
- ByBit multi-page pagination beyond 1000
- Scrubber, timeline seek, Restart control, step-one-candle buttons
- Simulated trading, balance, Long/Short (S-03)
- Diary markers, AI coach, multi-symbol, multi-timeframe
- Overlay / floating transport chrome on the chart canvas
- Component-level Testing Library tests for chart DOM
- Backend playback APIs or server-side session clock

## Implementation Approach

Keep playback state in `Dashboard` (full candles, session start index, playhead, playing, speed). Extract pure helpers for start-index resolution, warm-up clamping, playhead advance, and speed→delay mapping; unit-test those with Vitest. On successful Load (while unlocked), replace the series and reset session state to paused warm-up from the chosen/default start. A sibling control strip provides Play/Pause, speed, and start-date. First Play locks the load form. `TradingChart` accepts the visible candle prefix (or full + playhead) and fits content only on identity/reset, using incremental updates for +1 advances.

## Critical Implementation Details

### Timing & lifecycle

Clear the playback timer on Pause, unmount, successful Load reset, and when the playhead reaches the last candle (auto-pause). Do not leave intervals running across Load aborts.

### User experience spec

Start-date changes are allowed only while the session is unlocked (before first Play). Changing start date while paused and unlocked recomputes warm-up (≥300 from start, clamped) and resets the playhead to that warm-up end — it must not reveal bars past the new playhead. After first Play, start-date and Load stay disabled for the rest of that in-memory session (page refresh is the escape until Restart/file workflows exist).

### State sequencing

Lock Load on the first successful transition to playing — not merely on Load. Failed Load keeps prior series and must not clear an already-locked playing session’s candles (same non-destructive failure policy as S-01); if still unlocked, failed Load leaves playback state untouched.

### Performance constraints

Never call `fitContent()` on every tick. Prefer `series.update(nextBar)` for single-candle advances; use `setData` + one `fitContent` (or equivalent visible-range set) only when the visible series is replaced (Load / start-date reset).

## Phase 1: Playback model + Vitest + fetch headroom

### Overview

Introduce pure playback helpers and a Vitest runner, and raise the practical ByBit fetch default to 1000 so a ≥300 warm-up plus forward play is feasible on one load.

### Changes Required:

#### 1. Pure playback helpers

**File**: `frontend/src/playback/` (new module; exact filenames left to implementer)

**Intent**: Centralize start-index resolution from a date, warm-up playhead (≥300 from start, clamped to length), next-playhead advance, end detection, and speed→wall-clock delay mapping so UI and tests share one contract.

**Contract**:
- Warm-up constant ≥ 300.
- Wall-clock delays for speeds `1 | 2 | 5` (suggested defaults: 500ms / 250ms / 100ms — tune only if manual E2E feels wrong; keep mapping in one function).
- Given `candles`, `sessionStartDate` (or ISO date string), return clamped start index (first candle at/after date; if all candles are before date, clamp to last valid warm-up window or empty-session rules documented in helper tests).
- `initialPlayhead(startIndex, length)` → `min(length, startIndex + WARMUP)` with WARMUP ≥ 300; if `length - startIndex < 300`, playhead = `length` (entire remaining window revealed, Play may immediately be at end).
- `advancePlayhead(playhead, length)` → next index or “at end” signal used to auto-pause.

#### 2. Vitest setup + helper tests

**File**: `frontend/package.json`, Vitest config beside Vite as needed, `frontend/src/playback/*.test.ts`

**Intent**: Add a minimal Vitest script without adopting Testing Library; cover warm-up clamping, advance/end, and speed delays.

**Contract**: `npm test` (or `npm run test`) runs Vitest for pure helpers. Cases include: length &lt; 300 after start; start date before first candle; start date after last candle; advance into auto-end; speed multipliers produce strictly shorter delays for higher speeds.

#### 3. Practical fetch limit

**File**: `frontend/src/services/api.ts` (and Dashboard call site if it should pass an explicit limit)

**Intent**: Load enough bars for warm-up + playback without claiming unlimited history.

**Contract**: Default client `limit` becomes **1000** (ByBit max already clamped server-side). Do not add pagination in this phase. Document in UI status or plan risk that exchange history is still capped at 1000 until file ingest.

### Success Criteria:

#### Automated Verification:

- `npm test` passes for playback helpers
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- With default Load, status shows up to 1000 candles when ByBit returns a full page (online)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Dashboard transport + session lock

### Overview

Wire session/playback state and the control strip: start-date, Play/Pause, speed, timer loop, and Load lock after first Play.

### Changes Required:

#### 1. Dashboard session state + timer

**File**: `frontend/src/components/Dashboard.tsx`

**Intent**: Own full candle series plus playback fields; drive visible candles from the playhead; run wall-clock ticks while playing; reset on successful Load while unlocked; lock Load and start-date after first Play.

**Contract**:
- State includes at least: full `candles`, `sessionStart` (date), `playhead` (visible count / exclusive end index), `playing`, `speed`, `sessionLocked` (true after first Play).
- Visible series passed to chart: `candles.slice(sessionStartIndex, playhead)` or `candles.slice(0, playhead)` only if session start is always 0 — prefer slicing from session start index so pre-start bars stay hidden.
- Play starts/resumes timer; Pause clears timer; at end → `playing=false`, playhead = length, timer cleared.
- Speed changes while playing retarget the delay without revealing extra bars.
- Successful Load while `!sessionLocked`: replace candles, clear error, recompute start index / warm-up playhead, `playing=false`.
- While `sessionLocked`: Load button and start-date control disabled; symbol/interval inputs disabled or ignored.
- Abort in-flight fetch on new Load attempt only when Load is still allowed.

#### 2. Playback control strip UI

**File**: `frontend/src/components/Dashboard.tsx`, `frontend/src/App.css`

**Intent**: Place Play/Pause, speed (1x/2x/5x), and start-date controls in a flex strip under the load form, reusing `.load-form` spacing/typography patterns.

**Contract**: Sibling of the load `<form>` (not nested inside it). Disable transport when no candles or when playhead already at end (Play disabled at end; Pause still meaningful only while playing). Speed control always settable when candles exist and not required to unlock. Accessible labels; disabled styling consistent with Load button.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run lint` passes
- `npm test` still passes

#### Manual Verification:

- After Load, warm-up shows ≥300 candles from the default/selected start (or all remaining if fewer)
- Play advances bars; Pause freezes; 2x/5x feel faster than 1x on wall clock
- At last candle, playback auto-pauses
- After first Play, Load and start-date cannot change the series; before first Play, start-date reset recomputes warm-up without peeking ahead

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Chart progressive reveal + E2E verification

### Overview

Adapt `TradingChart` so progressive playback does not refit the viewport every tick, then verify the full S-02 flow manually against FR-002/FR-003.

### Changes Required:

#### 1. TradingChart update semantics

**File**: `frontend/src/components/TradingChart.tsx`

**Intent**: Support load/reset full replace vs single-candle (or prefix) advances without fighting pan/zoom.

**Contract**: On empty data, clear series. On session reset / first paint of a new visible series, `setData` + `fitContent` (or set a sensible visible range once). On playhead +1 with the same session series identity, prefer `series.update` for the new last bar (or `setData` without `fitContent`). Chart remains free of Play/Pause/speed state.

#### 2. Status copy / empty states

**File**: `frontend/src/components/Dashboard.tsx`

**Intent**: Make session state legible (loaded count, playing/paused, locked) without adding trade UI.

**Contract**: Status line reflects playback/locked state in plain language; chart placeholder still shows when no candles loaded.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run typecheck` passes
- `npm test` passes
- `dotnet test` still passes (no backend behavior change required; smoke regression)

#### Manual Verification:

- E2E: Load BTCUSDT 1h → set start date → see warm-up → Play → change speed → Pause → Play to end → auto-pause; future bars never appear early
- Viewport does not hard-reset zoom on every tick
- Failed Load (while unlocked) shows error and keeps prior series; while locked, Load remains unavailable
- No regressions to basic chart render from S-01

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Warm-up ≥300 clamping when remaining length is smaller
- Start-date → index mapping (before first, mid-series, after last)
- Playhead advance and end/auto-pause signal
- Speed → delay monotonicity (5x &lt; 2x &lt; 1x)

### Integration Tests:

- None required for S-02 (no new API). Optional later: WebApplicationFactory unchanged.

### Manual Testing Steps:

1. `npm run dev` + API up → Load → confirm ~1000 candles when available
2. Choose a mid-series start date → confirm warm-up size and hidden pre-start / future bars
3. Play at 1x, switch to 5x, Pause, resume
4. Let playback reach the end → confirm auto-pause and Play disabled (or no further advances)
5. Confirm Load locked after first Play; refresh page to load a new series
6. While unlocked, trigger a failed Load → prior chart retained

## Performance Considerations

- Cap temporary API series at 1000 bars; avoid remapping the full OHLC array into lightweight-charts on every tick.
- Prefer incremental `update` for advances; reserve `fitContent` for resets.

## Migration Notes

- No DB or API schema migration.
- Frontend default `limit` 200 → 1000 may make first paint slightly heavier; acceptable for S-02 headroom.
- Follow-on file ingest should replace ByBit Load as the dataset source while reusing the same playhead/lock/start-date model.

## References

- PRD: `context/foundation/prd.md` (FR-002, FR-003)
- Roadmap: `context/foundation/roadmap.md` (S-02)
- Prior slice: `context/archive/2026-11-07-load-candles-chart/`
- Chart: `frontend/src/components/TradingChart.tsx`
- Shell: `frontend/src/components/Dashboard.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Playback model + Vitest + fetch headroom

#### Automated

- [x] 1.1 `npm test` passes for playback helpers
- [x] 1.2 `npm run typecheck` passes
- [x] 1.3 `npm run lint` passes

#### Manual

- [ ] 1.4 With default Load, status shows up to 1000 candles when ByBit returns a full page (online)

### Phase 2: Dashboard transport + session lock

#### Automated

- [x] 2.1 `npm run typecheck` passes
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npm test` still passes

#### Manual

- [ ] 2.4 After Load, warm-up shows ≥300 candles from the default/selected start (or all remaining if fewer)
- [ ] 2.5 Play advances bars; Pause freezes; 2x/5x feel faster than 1x on wall clock
- [ ] 2.6 At last candle, playback auto-pauses
- [ ] 2.7 After first Play, Load and start-date cannot change the series; before first Play, start-date reset recomputes warm-up without peeking ahead

### Phase 3: Chart progressive reveal + E2E verification

#### Automated

- [x] 3.1 `npm run build` passes
- [x] 3.2 `npm run typecheck` passes
- [x] 3.3 `npm test` passes
- [x] 3.4 `dotnet test` still passes (no backend behavior change required; smoke regression)

#### Manual

- [ ] 3.5 E2E: Load BTCUSDT 1h → set start date → see warm-up → Play → change speed → Pause → Play to end → auto-pause; future bars never appear early
- [ ] 3.6 Viewport does not hard-reset zoom on every tick
- [ ] 3.7 Failed Load (while unlocked) shows error and keeps prior series; while locked, Load remains unavailable
- [ ] 3.8 No regressions to basic chart render from S-01
