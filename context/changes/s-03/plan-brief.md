# Open and Close Simulated Positions — Plan Brief

> Full plan: `context/changes/s-03/plan.md`

## What & Why

Learners need to open/close Long and Short on a playing historical session with a configurable paper balance (FR-004–007) — the roadmap north star before diary/AI. This slice also journals closed trades in a shape S-04 can mark on a chart without redesign.

## Starting Point

S-01/S-02 deliver client-side load + progressive playback in `Dashboard` (`sessionLocked`, playhead, visible candle prefix). There is no trading domain, balance, or order UI yet; the chart stays marker-free by design.

## Desired End State

On a locked session the learner sizes with qty or % of wallet, submits market/limit opens and closes, pyramids and hedges (hidden lots, net-per-side display), parks many free-form limits that fill on bar high/low touch, cancels pendings, and sees paper balance plus a closed-trade list — still no chart markers.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| Markers | Records only; draw in S-04 | Keeps north star focused; matches prior “markers later” split |
| Sizing | Qty \| % toggle | User wants both entry styles without dual-field sync bugs |
| Leverage | 1x only | Defer margin/liquidation; easy to extend later |
| Book | Pyramid + hedge | Practice richer than single flat position |
| Display vs internals | Net per side UI; hidden lots | Avg entry for UX; FIFO/diary need per-entry lots |
| Close | FIFO lot + Close all | Scale out without a heavy lot picker |
| Fill (market) | Last visible close | Aligns with no-peek playback |
| Orders | Market + limit on open and close | Full ticket; limit not close-only |
| Limit fill | Touch on new bar OHLC | Standard candle rule; wick-aware |
| Pending book | Many free-form + cancel | User-requested flexibility |
| Wallet | Paper PnL, soft notional cap | No margin engine; still bounds size |
| When | After session lock, Play or Pause | Deliberate entries without racing the clock |
| Start balance | Editable until first Play | Same lock semantics as Load/start-date |

## Scope

**In scope:** Starting balance (default $10k), paper balance readout, qty/% sizing, market/limit open & close, multi limit book + cancel + touch fills, hidden lots / net sides, FIFO + close-all, closed-trade list, Vitest engine, Dashboard wiring.

**Out of scope:** Chart markers, diary/AI, leverage/fees/partials, backend/DB, live orders, Restart/file ingest, chart overlays.

## Architecture / Approach

Pure `frontend/src/trading/` helpers (lots, orders, match, PnL) + Vitest; `Dashboard` owns session trading state next to playback; on each playhead +1, match limits against the new bar; sibling UI strips for ticket / pendings / balance; `TradingChart` unchanged (no markers).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Trading engine + Vitest | Domain + touch/FIFO/cap tests | Touch-rule edge cases / soft-cap at fill |
| 2. Dashboard wiring | Balance lock + match on advance | Double-match or reset races with Load |
| 3. Trade UI + closed trades | Ticket, pendings, net, journal list | UX clutter; keep chart clean |

**Prerequisites:** S-02 done (playing locked session); Node for Vitest; online ByBit for manual E2E.
**Estimated effort:** ~3–4 sessions across 3 phases (limit book + pyramid/hedge add weight vs a flat market-only slice).

## Open Risks & Assumptions

- Soft notional cap on a paper wallet is a teaching guardrail, not exchange margin — oversized hedges may feel permissive or strict depending on balance after losses.
- Change folder `s-03` ≠ roadmap Change ID `sim-open-close-positions` — roadmap auto-status sync will not flip until ids align.
- Many free-form limits without a blotter polish pass may feel raw; MVP list + cancel is enough.

## Success Criteria (Summary)

- Learner can configure balance, then market/limit trade Long and Short with qty or % on a locked session
- Pyramid/hedge, FIFO/close-all, and multi-limit touch fills behave as specified; closed trades list is diary-ready
- No chart markers; playback lock/reveal behavior from S-02 preserved
