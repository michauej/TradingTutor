# Rebuild UI (`/trade` workspace) Implementation Plan

## Overview

Rebuild the `/trade` screen so the chart and primary trade controls share one laptop viewport. Cut vertical scroll by a small CSS workspace shell, a denser close panel, and capped history — without changing trade logic or adding a design-system package.

## Current State Analysis

`/trade` renders `Dashboard` as a single centered column (`.dashboard`, max-width 64rem). Document scroll owns the page; nothing is sticky or split. Order ticket, three close forms, pending/open/closed tables, status, and overlays all sit **above** `TradingChart`, so price action is below the fold.

`TradingChart` stays presentational (`autoSize: true`, no app-side resize). Height comes from `.chart-container { height: min(28rem, 70vh) }`. Sections can be reordered safely (no refs / scroll coupling). Layout is global CSS only; no tabs, collapse, grid workspace, or media queries exist today. Diary already places the chart earlier; trade does not.

Research mapped the density pain; planning locked: split primary/secondary regions, always-on ticket + playback + open lots + chart, capped closed list on `/trade`, small App.css shell, ~900px laptop acceptance, one close panel with mode switch.

## Desired End State

On a ~900px-tall laptop viewport (~1366×768–1440×900), a trader on `/trade` sees the chart and the always-on controls (ticket, playback, open lots) without scrolling the page to find price action. Close uses one compact market/TP/SL mode panel. Open lots and closed history use capped height with inner scroll. Trade open/close/playback behavior is unchanged. Diary, session entry, and APIs are untouched.

### Key Discoveries:

- Chart last in DOM; full stack above it — `frontend/src/components/Dashboard.tsx:312-817`
- No sticky/grid/media queries; `.dashboard` is block flow — `frontend/src/App.css:1-5`
- Chart size is CSS + `autoSize`; parent must supply a definite height for flex fill — `TradingChart.tsx:64-82`, `App.css:841-848`
- Close triple-form band — `Dashboard.tsx:523-614`; mode-switch pattern already exists for ticket/sizing — `Dashboard.tsx:445-508`
- Open lots table has x-scroll only — `App.css:760-762`; no y-cap today
- Prior constraint: keep `TradingChart` presentational; chrome as sibling strips in `App.css` (no UI kit)

## What We're NOT Doing

- No Tailwind / MUI / Radix / shadcn or other design-system adoption
- No changes to session entry (`/`), Diary (`/diary`), or backend APIs
- No removal of closed-trade history from `/trade` (cap + secondary only)
- No resizable drag panes or persisted layout preferences
- No rewrite of trade/session state logic or playback engine
- No new automated layout/E2E tests required in this change (manual viewport check is the acceptance bar)
- No mobile-first responsive redesign beyond “primary regions remain usable if the window is narrow” (stack regions if needed; not a separate mobile product pass)

## Implementation Approach

Introduce a **workspace shell** on `.dashboard`: a primary region (chart + ticket + playback + open lots) that fits the first viewport, and a secondary region (close panel, pending, capped closed list, overlays, status, compact header/interval/account). Use CSS grid/flex in `App.css` only. Reorder JSX in `Dashboard.tsx`; keep handlers and session wiring as-is.

Then densify close UI into one mode-switched form (reuse `ticketType`/`sizingMode` select pattern). Cap open-lots and closed-trades wraps with `max-height` + `overflow-y: auto`. Finally place remaining chrome in secondary space and verify the ~900px acceptance target.

## Critical Implementation Details

**Chart height chain:** `TradingChart` does not call `resize()`. If the chart pane uses `flex: 1` / `height: 100%`, every ancestor through `.chart-container` must establish a definite height (viewport-constrained workspace, not content-sized document flow). Otherwise the chart collapses toward `min-height: 18rem` and the “no scroll to chart” goal fails even when JSX order is correct.

**Always-on vs secondary:** Ticket, playback, open lots, and chart stay in the primary region. Close, pending, capped closed list, overlays, and non-essential header copy move secondary — still on `/trade`, not removed.

## Phase 1: Workspace shell

### Overview

Add a CSS workspace shell and reorder `Dashboard` so chart and always-on controls share the first viewport. Keep existing close forms and tables functionally intact; place non-always-on blocks into a secondary region for later densify.

### Changes Required:

#### 1. Dashboard workspace structure

**File**: `frontend/src/components/Dashboard.tsx`

**Intent**: Restructure the JSX into primary and secondary regions so the chart is no longer last below all chrome. Always-on blocks (ticket, playback, open lots, chart) live in the primary region; other strips move secondary without changing their handlers.

**Contract**: Root `.dashboard` contains explicit region wrappers (e.g. primary / secondary class names). Primary includes playback, trade ticket, open-trades section, and `TradingChart`. Secondary holds header (or a compact remnant), interval, account, close-controls (still three forms), pending, closed-trades, status, overlays. No trade API or state-shape changes.

#### 2. Workspace layout CSS

**File**: `frontend/src/App.css`

**Intent**: Replace the tall single-column document stack with a viewport-oriented shell so primary regions share the first screen and the chart pane can grow.

**Contract**: New workspace rules under `.dashboard` (grid or flex). Primary region constrained to available viewport height (account for padding). Chart pane and `.chart-container` get a definite flex/grid height chain (replace sole reliance on `min(28rem, 70vh)` for `/trade` workspace). Keep existing strip class names where possible; avoid a design-system dependency. Narrow windows may stack primary sub-regions; no full breakpoint system required.

#### 3. TradingChart height compatibility

**File**: `frontend/src/components/TradingChart.tsx` (only if required)

**Intent**: Keep the chart presentational; only touch this file if the workspace height chain needs a class or wrapper tweak that cannot live in CSS alone.

**Contract**: No new trading props. Prefer CSS-only sizing; if a className or wrapper change is needed so `autoSize` tracks the pane, keep the public props (`candles`, optional markers/overlays) unchanged.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint` (in `frontend/`)
- Typecheck passes: `npm run typecheck` (in `frontend/`)
- Existing unit tests pass: `npm run test` (in `frontend/`)

#### Manual Verification:

- On ~1440×900 (or similar), chart and ticket/playback/open lots are visible together without scrolling to discover the chart
- Open / playback / interval / account controls still work
- Page is no longer “all tables then chart at the bottom” as the only layout
- Diary and session entry screens look unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Close panel + history density

### Overview

Replace the triple close-form band with one mode-switched close panel. Cap open-lots and closed-trades height with inner scroll so history cannot push the primary viewport apart.

### Changes Required:

#### 1. Unified close panel

**File**: `frontend/src/components/Dashboard.tsx`

**Intent**: Cut vertical density of market / TP / SL by one compact form with a mode control, reusing the existing select + conditional-fields pattern from the open ticket.

**Contract**: Single close UI with mode ∈ { market, take-profit, stop-loss } (naming consistent with current form labels). Existing close handlers remain the source of truth — wire the visible fields to the same submit paths. Shared side selector stays available for the active mode. Remove the three simultaneous full forms from the default layout.

#### 2. Close panel CSS

**File**: `frontend/src/App.css`

**Intent**: Style the unified close block as one strip aligned with `.trade-ticket` / `.close-controls` density, not three stacked forms.

**Contract**: Update or replace `.close-controls` / `.close-*-form` rules so one mode panel fits in the secondary region without a multi-row form band. Preserve accessible labels.

#### 3. Capped trade tables

**File**: `frontend/src/App.css` (and `Dashboard.tsx` only if markup needs a wrap class)

**Intent**: Stop unbounded open/closed tables from owning vertical space. Closed list stays on `/trade` but secondary and capped.

**Contract**: Open-trades and closed-trades wraps gain `max-height` + `overflow-y: auto` (keep existing `overflow-x: auto` behavior). Prefer showing a short recent closed set or scrollable full list inside the cap — do not remove closed history from `/trade`. Empty hints may remain.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint` (in `frontend/`)
- Typecheck passes: `npm run typecheck` (in `frontend/`)
- Existing unit tests pass: `npm run test` (in `frontend/`)

#### Manual Verification:

- Market close, take-profit, and stop-loss each work via the mode switch
- Open-lots table scrolls inside its cap when many lots exist; primary chart region does not grow without bound
- Closed list is reachable on `/trade` but does not dominate height
- Per-row Close on open lots still works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Secondary chrome + acceptance

### Overview

Finish secondary placement (interval, account, pending, overlays, status, header density) and verify the agreed laptop acceptance target end-to-end.

### Changes Required:

#### 1. Secondary chrome placement

**File**: `frontend/src/components/Dashboard.tsx`

**Intent**: Keep interval, account, pending, overlays, and status available without competing with the primary trade loop for first-viewport space.

**Contract**: Those blocks live in the secondary region (or a compact primary header strip if essential for orientation — e.g. short title + diary link). Do not remove features; prefer tighter copy/spacing over new components. Pending empty state should not invent large permanent chrome.

#### 2. Secondary / density CSS polish

**File**: `frontend/src/App.css`

**Intent**: Tighten secondary spacing and ensure the workspace meets the ~900px “chart visible without hunting” bar with always-on blocks present.

**Contract**: Adjust margins/padding for secondary strips; confirm chart height chain still holds with Phase 2 caps. No new dependency. Narrow window: primary regions remain usable (stack acceptable).

#### 3. Acceptance pass (no new product features)

**File**: none required (verification only; fix regressions in the files above if found)

**Intent**: Prove the change meets the planning success bar and did not regress trading or sibling routes.

**Contract**: Manual checklist in this phase’s success criteria is the gate. Fix only layout/CSS/JSX regressions discovered during the pass.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint` (in `frontend/`)
- Typecheck passes: `npm run typecheck` (in `frontend/`)
- Existing unit tests pass: `npm run test` (in `frontend/`)
- Production build succeeds: `npm run build` (in `frontend/`)

#### Manual Verification:

- At ~1366×768–1440×900, trader sees chart + ticket + playback + open lots without page-scrolling to find the chart
- Secondary chrome (close mode panel, pending, capped closed, overlays, status, interval/account) is reachable with clear structure
- Full smoke: change interval, play/pause, open market/limit, close via mode panel, save account message path if applicable
- `/` and `/diary` unchanged in layout and behavior

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- No new layout unit tests required for this change (no layout test harness today)
- Rely on existing `frontend` vitest suite to catch accidental domain regressions

### Integration Tests:

- None added in this plan (no Playwright/layout suite in scope)

### Manual Testing Steps:

1. Open `/trade` at ~1440×900: confirm chart + ticket + playback + open lots share the first view
2. Open a position; confirm open lots update inside the capped region
3. Close via market, then TP, then SL modes
4. Add several closed trades; confirm closed list scrolls inside cap and does not bury the chart
5. Toggle structure overlays; confirm secondary placement
6. Spot-check `/diary` and session setup links from the header

## Performance Considerations

Chart `autoSize` follows container size; avoid layout thrash from rapidly toggling workspace height. Table caps prevent unbounded DOM height; long sessions should scroll inside wraps, not grow the document without limit. No virtualization required for MVP session sizes.

## Migration Notes

No data migration. Layout-only frontend change. Users see a new arrangement of existing controls; close UX gains a mode switch (same capabilities).

## References

- Related research: `context/changes/rebuild-ui/research.md`
- Dashboard stack: `frontend/src/components/Dashboard.tsx:312-817`
- Chart sizing: `frontend/src/components/TradingChart.tsx:64-82`, `frontend/src/App.css:841-848`
- Close band: `frontend/src/components/Dashboard.tsx:523-614`
- Mode-switch precedent: `frontend/src/components/Dashboard.tsx:445-508`
- Prior presentational-chart constraint: `context/changes/s-03/plan.md`, archive playback / S-04 plans

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Workspace shell

#### Automated

- [x] 1.1 Lint passes: `npm run lint` (in `frontend/`)
- [x] 1.2 Typecheck passes: `npm run typecheck` (in `frontend/`)
- [x] 1.3 Existing unit tests pass: `npm run test` (in `frontend/`)

#### Manual

- [ ] 1.4 On ~1440×900 (or similar), chart and ticket/playback/open lots are visible together without scrolling to discover the chart
- [ ] 1.5 Open / playback / interval / account controls still work
- [ ] 1.6 Page is no longer “all tables then chart at the bottom” as the only layout
- [ ] 1.7 Diary and session entry screens look unchanged

### Phase 2: Close panel + history density

#### Automated

- [x] 2.1 Lint passes: `npm run lint` (in `frontend/`)
- [x] 2.2 Typecheck passes: `npm run typecheck` (in `frontend/`)
- [x] 2.3 Existing unit tests pass: `npm run test` (in `frontend/`)

#### Manual

- [ ] 2.4 Market close, take-profit, and stop-loss each work via the mode switch
- [ ] 2.5 Open-lots table scrolls inside its cap when many lots exist; primary chart region does not grow without bound
- [ ] 2.6 Closed list is reachable on `/trade` but does not dominate height
- [ ] 2.7 Per-row Close on open lots still works

### Phase 3: Secondary chrome + acceptance

#### Automated

- [x] 3.1 Lint passes: `npm run lint` (in `frontend/`)
- [x] 3.2 Typecheck passes: `npm run typecheck` (in `frontend/`)
- [x] 3.3 Existing unit tests pass: `npm run test` (in `frontend/`)
- [x] 3.4 Production build succeeds: `npm run build` (in `frontend/`)

#### Manual

- [ ] 3.5 At ~1366×768–1440×900, trader sees chart + ticket + playback + open lots without page-scrolling to find the chart
- [ ] 3.6 Secondary chrome (close mode panel, pending, capped closed, overlays, status, interval/account) is reachable with clear structure
- [ ] 3.7 Full smoke: change interval, play/pause, open market/limit, close via mode panel, save account message path if applicable
- [ ] 3.8 `/` and `/diary` unchanged in layout and behavior
