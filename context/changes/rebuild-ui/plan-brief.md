# Rebuild UI — Plan Brief

> Full plan: `context/changes/rebuild-ui/plan.md`
> Research: `context/changes/rebuild-ui/research.md`

## What & Why

Rebuild the `/trade` screen so trading is clearer and needs less scroll. Today every control and table sits above the chart, so price action is below the fold. This plan makes the chart and primary controls share one laptop viewport.

## Starting Point

`Dashboard` is one tall CSS column with document scroll and no split/sticky shell. `TradingChart` is last in the DOM; height is `min(28rem, 70vh)` via CSS + `autoSize`. Research documented the density drivers; no prior change delivered a workspace layout.

## Desired End State

On a ~900px-tall laptop, the trader sees chart + ticket + playback + open lots without hunting down the page. Close is one mode panel (market / TP / SL). History stays on `/trade` but capped. Trade logic and Diary stay the same.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| -------- | ------ | ---------------- | ------ |
| Scope | `/trade` only | Research agreed main trading screen / scroll focus | Research |
| Layout | Split primary/secondary workspace | Chart and decision UI must share the first viewport | Plan |
| Always on | Ticket + playback + open lots + chart | Covers the core trade loop | Plan |
| Closed history | Cap + keep on `/trade` | Cut height without removing quick review | Plan |
| CSS model | Small App.css shell, no UI kit | Matches stack and prior “sibling strips” constraint | Plan |
| Success bar | ~900px laptop (≈1366×768–1440×900) | Testable student-laptop target | Plan |
| Close UI | One panel + mode switch | Densifies the triple-form band; reuses ticket select pattern | Plan |

## Scope

**In scope:** `/trade` workspace shell; JSX region reorder; chart height chain; unified close panel; capped open/closed tables; secondary chrome placement; manual viewport acceptance.

**Out of scope:** Design-system adoption; Diary/session entry redesign; API/state rewrites; resizable panes; new E2E layout suite; full mobile product pass.

## Architecture / Approach

`.dashboard` becomes a viewport-oriented CSS grid/flex shell: **primary** (chart + ticket + playback + open lots) and **secondary** (close mode panel, pending, capped closed, overlays, status, interval/account). `TradingChart` stays presentational; sizing follows a definite CSS height chain so `autoSize` fills the pane.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Workspace shell | Primary/secondary regions + chart in first viewport | Chart height chain collapses if ancestors lack definite height |
| 2. Close + history density | Mode-switched close; capped tables | Mode wiring misses a close path |
| 3. Secondary + acceptance | Chrome placement + ~900px proof | Secondary still too tall; acceptance fails |

**Prerequisites:** Research complete; `/trade` session flow working on `feature/ict`.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Flex/`height: 100%` must propagate to `.chart-container` or the chart will not fill the pane.
- Narrow windows may stack primary regions; not a dedicated mobile redesign.
- Closed list remains duplicated with Diary (already true); cap only, no single-source UI merge.

## Success Criteria (Summary)

- At ~900px height, chart + always-on controls are visible without page-scrolling to find the chart
- Market / TP / SL closes work from one mode panel
- `/` and `/diary` unchanged; existing frontend lint, typecheck, and tests pass
