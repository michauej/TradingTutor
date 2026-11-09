# Playback Controls — Plan Brief

> Full plan: `context/changes/playback-controls/plan.md`

## What & Why

Learners need Play / Pause and playback speed (1x / 2x / 5x) on the sim chart (S-02 / FR-002–003) so a historical session can advance without peeking the future. This unblocks S-03 trading on a playing session while keeping trade logic out of this slice.

## Starting Point

S-01 loads a full ByBit candle series into `Dashboard` and renders all of it at once in `TradingChart`. There is no playhead, timer, transport UI, or frontend test runner; fetch defaults to 200 bars (ByBit hard-max 1000, no pagination).

## Desired End State

After Load, the learner picks a session start date, sees ≥300 warm-up candles from that start (clamped), then Play / Pause with wall-clock speeds that progressively reveal bars until the series end (auto-pause). Load locks after the first Play. File-based “all candles” ingest stays a follow-on; API remains a temporary ≤1000-bar source.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| Scope | Transport + start-date + Load lock; no scrubber/Restart | Matches FR-002/003 and the training model without file ingest yet |
| Reveal | Progressive (no future peek) | Required for realistic sim and S-03 |
| Warm-up | ≥300 candles from session start | Enough context before Play; clamp if fewer remain |
| End behavior | Auto-pause at last candle | Predictable; no loop |
| Speed | Fixed wall-clock ms (1x/2x/5x) | Simple, TF-independent feel |
| Dataset (S-02) | ByBit @ 1000; file later | Ships playback now; true full-file series is next |
| Session lock | After first Play | Allows start-date tweaks pre-Play; then immutable series |
| Controls | Strip under load form | Matches existing `.load-form` pattern; chart stays dumb |
| Verification | Vitest for pure helpers + manual chart E2E | Guards tick math without heavy UI harness |

## Scope

**In scope:** Play/Pause, 1x/2x/5x, start-date within loaded series, ≥300 warm-up, progressive reveal, auto-pause at end, Load lock after first Play, default limit 1000, Vitest helpers, chart tick-safe updates.

**Out of scope:** File ingest, pagination &gt;1000, scrubber/Restart, trading/balance, diary/AI, overlay transport, DOM component tests.

## Architecture / Approach

`Dashboard` keeps the full series and playback state (start index, playhead, playing, speed, locked) and passes only the visible session prefix to `TradingChart`. Pure helpers own warm-up/advance/speed math. Chart: `setData` + fit on reset; incremental `update` on ticks. ByBit Load remains until a later file change reuses the same session model.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Model + Vitest + limit 1000 | Helpers, tests, enough bars for warm-up | Start-date edge cases / length &lt; 300 |
| 2. Transport + session lock | Controls, timer, Load lock | Lock/reset races with in-flight fetch |
| 3. Chart reveal + E2E | Tick-safe chart + full manual path | `fitContent` fighting pan/zoom each tick |

**Prerequisites:** S-01 done (chart + ByBit load); Node for Vitest; online ByBit for manual E2E.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Exchange history remains capped at 1000 until file ingest; “no artificial end” means end of loaded series, not unlimited market history.
- Suggested delays (500/250/100 ms) may need a quick manual tune.
- Page refresh is the only way to unlock a new series until Restart/file workflows exist.

## Success Criteria (Summary)

- Play / Pause and 1x/2x/5x work on progressive chart reveal from a chosen start date
- Warm-up ≥300 (or all remaining); auto-pause at last candle; no future peek
- Load locked after first Play; helper unit tests + manual E2E pass
