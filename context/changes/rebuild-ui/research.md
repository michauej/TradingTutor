---
date: 2026-11-24T16:15:40+01:00
researcher: Auto
git_commit: 985d3113d7dfa77ed88acc31f4a56d86612e149f
branch: feature/ict
repository: TradingTutor
topic: "Make the main trading screen clearer and easier to use by reducing scroll / vertical density"
tags: [research, codebase, Dashboard, TradingChart, App.css, scroll, density, layout]
status: complete
last_updated: 2026-11-24
last_updated_by: Auto
---

# Research: Make the main trading screen clearer and easier to use (scroll / density)

**Date**: 2026-11-24T16:15:40+01:00
**Researcher**: Auto
**Git Commit**: 985d3113d7dfa77ed88acc31f4a56d86612e149f
**Branch**: feature/ict
**Repository**: TradingTutor

## Research Question

User goal: rebuild the UI so it is clearer and easier to use. Today it is hard to use and needs too much scrolling.

Agreed scope for this research:

- **Scope**: main trading screen only (`/trade`)
- **Depth**: detailed analysis
- **Focus**: scrolling / density (what is tall, stacked, or pushed below the fold)

## Summary

The trading screen is a **single centered column** (`max-width: 64rem`) with **document-level vertical scroll** and **no sticky or split layout**. Almost all trading chrome lives **above** the chart: header, interval, playback, account, open ticket, three close forms, pending/open/closed tables, status lines, then overlay toggles. `TradingChart` is **last** in the DOM and still reserves `min(28rem, 70vh)`. Users must scroll to see price action while primary controls stay at the top.

There is no component library (global CSS only). Density helpers are limited to `flex-wrap`, conditional limit fields, and empty-state hints — **no tabs, collapse, drawers, or resizable panes**. Prior context decisions favored sibling control strips and a presentational chart; none specified a scroll model or multi-pane workspace.

## Detailed Findings

### Entry point and page shell

- Route `/trade` renders `Dashboard` ([App.tsx](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/App.tsx#L14-L15)).
- No shared app shell (no sidebar, no nested layout outlet). Session setup (`/`) and diary (`/diary`) are separate routes.
- Page root: `div.dashboard` in [Dashboard.tsx](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/components/Dashboard.tsx#L312-L817).
- Global viewport: `body` / `#root` use `min-height: 100vh` only — page grows and scrolls with the window ([index.css](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/index.css#L30-L41)).
- `.dashboard` is block flow, not flex/grid workspace ([App.css](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/App.css#L1-L5)).

### Top-to-bottom section inventory (`/trade`)

Order in `Dashboard` JSX:

1. Header (title, intro, links to session setup / diary) — ~314–329
2. Chart interval (`load-form`) — ~331–352
3. Playback (speed, Play, Pause) — ~354–388
4. Account strip (balance, net, Save) — ~390–426
5. Open order ticket — ~428–521
6. Close controls (market + TP + SL forms) — ~523–614
7. Pending orders — ~616–641
8. Open trades table — ~643–708
9. Closed trades table — ~710–753
10. Status / error / warning lines — ~755–780
11. Structure overlay toggles — ~782–810
12. **Chart (`TradingChart`)** — ~812–817 — **last**

### Scroll model

| Region | Behavior |
|--------|----------|
| Whole page | Browser document scroll; nothing sticky/fixed |
| Trade tables | Vertical via page scroll; horizontal via `.trades-table-wrap { overflow-x: auto }` ([App.css](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/App.css#L760-L762)) |
| Chart | Fixed height box `height: min(28rem, 70vh); min-height: 18rem; overflow: hidden` ([App.css](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/App.css#L841-L849)); pan/zoom inside lightweight-charts |

No `overflow-y: auto` main panel, no sticky header/ticket/chart, no CSS Grid workspace, no `@media` breakpoints in frontend.

### High-impact density / scroll pain points

1. **Chart below the fold** — All controls and both trade tables sit above the chart. Decision UI and price action cannot share one viewport without scrolling ([Dashboard.tsx](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/components/Dashboard.tsx#L312-L817)). Diary places the chart much earlier; trading inverts that pattern.
2. **Tall chart after a long stack** — Chart still takes up to 70vh after all chrome above it ([App.css](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/App.css#L841-L848)).
3. **No split / sticky layout** — Single column; ticket and chart cannot dock side-by-side or pin to the viewport.
4. **Triple close-form band** — Market close, take-profit, and stop-loss are three full forms in one wrapping block (~523–614), often multi-row inside 64rem.
5. **Unbounded tables before the chart** — Open and closed trade tables grow with session length (~643–753), pushing the chart further down.

### Medium-impact contributors

- Empty pending/open/closed sections and status lines still render headers/hints (~616–780).
- Full-width hints (`.load-form-hint`, mark hint with `flex-basis: 100%`) add rows ([App.css](https://github.com/michauej/TradingTutor/blob/985d3113d7dfa77ed88acc31f4a56d86612e149f/frontend/src/App.css#L525-L531)).
- Nested scroll feel: page vertical + table horizontal.
- Open is reachable without scroll; **chart visibility while trading** is the main friction (not “scroll to Open”).

### Component / CSS inventory

| Piece | Role | Height impact |
|-------|------|----------------|
| `Dashboard.tsx` | Entire trading screen (mostly inline JSX) | Dominates page height |
| `TradingChart.tsx` | Candlestick + overlays | Fixed tall box at bottom |
| Global CSS (`index.css` + `App.css`) | Tokens + all layout | No design-system package |
| Sections / flex toolbars | Native HTML + class names | Stack with ~1.25rem margins |

**Not present on `/trade`:** Card/Panel/ScrollArea/Resizable components, tabs, drawers, modals, side panels, accordion collapse.

**Existing density tricks:** `flex-wrap` toolbars; conditional limit / qty-vs-% fields; empty-state hints; chart height cap; structure overlays default off.

**Dependencies:** React 19, react-router-dom, lightweight-charts only — no Tailwind/MUI/Radix/shadcn.

## Code References

- `frontend/src/App.tsx:14-15` — `/trade` → `Dashboard`
- `frontend/src/components/Dashboard.tsx:312-817` — full vertical stack; chart last
- `frontend/src/components/Dashboard.tsx:523-614` — close-controls triple form band
- `frontend/src/components/Dashboard.tsx:643-753` — open/closed tables before chart
- `frontend/src/components/TradingChart.tsx:239-250` — chart panel mount
- `frontend/src/App.css:1-5` — `.dashboard` column shell
- `frontend/src/App.css:760-762` — horizontal table scroll
- `frontend/src/App.css:841-849` — chart container height / overflow
- `frontend/src/index.css:30-41` — `min-height: 100vh` document chrome

## Architecture Insights

- Historical pattern: keep `TradingChart` presentational; add trading chrome as **sibling strips** above the chart (S-02/S-03). That pattern produced a long vertical form → table → chart page.
- Layout is **feature-additive stacking**, not a workspace shell. Each new strip (ticket, closes, tables, overlays) increased scroll length.
- Diary chose a dedicated route for density reasons (“clear analysis screen vs denser Dashboard panel”); trading never got an equivalent density pass.
- Rebuild options that match the pain (for later planning, not decided here): chart-first or split pane; sticky ticket/chart; collapse/tabs for close forms and history tables; cap table height with inner scroll; move history off the primary viewport.

## Historical Context (from prior changes)

- `context/archive/2026-11-08-playback-controls/` — Control strip under load form; chart stays dumb; avoid `fitContent` every tick.
- `context/changes/s-03/` — Sibling UI strips for ticket / pendings / balance; `TradingChart` unchanged.
- `context/archive/2026-11-09-s-04/` — Dedicated `/diary` instead of packing analysis into Dashboard.
- `context/changes/positon-handling/` — Session entry screen gate; trading Dashboard after Start (`/trade`).
- `context/changes/ict-develop/` — Diary coach/overlays; Dashboard unchanged by default.
- `context/archive/2026-11-18-rebuild/` — Data/load UX on Dashboard, **not** a full layout rebuild.
- Foundation PRD/roadmap stress chart + playback + trade + diary flow, not a scroll/workspace redesign.
- **No prior docs** define scrolling containers, docking, or resizable trading panels.

## Related Research

- No prior `research.md` for a trading-screen layout rebuild.
- Closest related plans: S-02/S-03 strip layout, S-04 diary split, `positon-handling` entry vs trade routes.

## Open Questions

1. Should the chart share the first viewport with the ticket (split layout), or stay full-width but move above tables?
2. Which blocks must stay always visible vs collapse/tab (close forms, closed trades, pending, overlays)?
3. Keep global CSS strip patterns, or introduce a small layout shell (grid + sticky regions) without a full design-system adoption?
4. Is closed-trade history needed on `/trade`, or is Diary the right place (would remove a major height driver)?
5. Target viewport (laptop height) for “no chart scroll” acceptance criteria?
