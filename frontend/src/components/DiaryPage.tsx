import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAnalyzeGate, mapClosedTradesForCoach } from '../coach'
import {
  BUY_MARKER_COLOR,
  SELL_MARKER_COLOR,
  buildTradeMarkers,
  buildTradeSpans,
} from '../diary'
import {
  ApiError,
  fetchCoachAnalyze,
  type CoachAnalyzeResult,
} from '../services/api'
import { useSession } from '../session'
import type { ClosedTrade, Lot, Side } from '../trading'
import TradingChart from './TradingChart'

type CoachPanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: CoachAnalyzeResult }
  | { status: 'error'; message: string }

type SideFilter = 'all' | Side

interface DiaryFilters {
  side: SideFilter
  /** Inclusive lower bound on entry time (ISO / date input). Empty = no bound. */
  timeFrom: string
  /** Inclusive upper bound on relevant time (exit for closed, entry for open). Empty = no bound. */
  timeTo: string
  /** Inclusive min qty. Empty = no bound. */
  qtyMin: string
  /** Inclusive max qty. Empty = no bound. */
  qtyMax: string
}

const EMPTY_FILTERS: DiaryFilters = {
  side: 'all',
  timeFrom: '',
  timeTo: '',
  qtyMin: '',
  qtyMax: '',
}

function formatPrice(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 8,
  })
}

function formatPnl(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`
}

function pnlPercent(pnl: number, entryPrice: number, qty: number): number | null {
  const notional = entryPrice * qty
  if (!(notional > 0)) {
    return null
  }
  return (pnl / notional) * 100
}

function formatPnlPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}%`
}

function formatTime(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) {
    return iso
  }
  return new Date(ms).toLocaleString()
}

/** Parse `YYYY-MM-DD` or full ISO into ms; date-only `to` is end-of-day UTC. */
function boundMs(value: string, endOfDay: boolean): number | null {
  if (!value.trim()) {
    return null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(
      endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`,
    )
    return Number.isNaN(ms) ? null : ms
  }
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function matchesCommonFilters(
  item: { side: Side; qty: number; entryTime: string },
  endTime: string,
  filters: DiaryFilters,
): boolean {
  if (filters.side !== 'all' && item.side !== filters.side) {
    return false
  }

  const fromMs = boundMs(filters.timeFrom, false)
  const toMs = boundMs(filters.timeTo, true)
  const entryMs = Date.parse(item.entryTime)
  const endMs = Date.parse(endTime)
  if (fromMs != null && (Number.isNaN(entryMs) || entryMs < fromMs)) {
    return false
  }
  if (toMs != null && (Number.isNaN(endMs) || endMs > toMs)) {
    return false
  }

  const qtyMin = parseOptionalNumber(filters.qtyMin)
  const qtyMax = parseOptionalNumber(filters.qtyMax)
  if (qtyMin != null && item.qty < qtyMin) {
    return false
  }
  if (qtyMax != null && item.qty > qtyMax) {
    return false
  }

  return true
}

function filterClosedTrades(
  trades: ClosedTrade[],
  filters: DiaryFilters,
): ClosedTrade[] {
  return trades.filter((trade) =>
    matchesCommonFilters(trade, trade.exitTime, filters),
  )
}

function filterOpenLots(lots: Lot[], filters: DiaryFilters): Lot[] {
  return lots.filter((lot) => matchesCommonFilters(lot, lot.entryTime, filters))
}

export default function DiaryPage() {
  const {
    sessionLocked,
    visibleCandles,
    closedTrades,
    lots,
    handlePause,
    playing,
  } = useSession()

  const [filters, setFilters] = useState<DiaryFilters>(EMPTY_FILTERS)
  const [coachState, setCoachState] = useState<CoachPanelState>({
    status: 'idle',
  })
  const coachAbortRef = useRef<AbortController | null>(null)

  // Pause once on diary entry; do not auto-resume when returning to sim.
  useEffect(() => {
    handlePause()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only pause
  }, [])

  useEffect(() => {
    return () => {
      coachAbortRef.current?.abort()
      coachAbortRef.current = null
    }
  }, [])

  const filteredClosed = useMemo(
    () => filterClosedTrades(closedTrades, filters),
    [closedTrades, filters],
  )
  const filteredLots = useMemo(
    () => filterOpenLots(lots, filters),
    [lots, filters],
  )

  const markers = useMemo(
    () => buildTradeMarkers(filteredClosed, filteredLots, visibleCandles),
    [filteredClosed, filteredLots, visibleCandles],
  )
  const tradeSpans = useMemo(
    () => buildTradeSpans(filteredClosed, visibleCandles),
    [filteredClosed, visibleCandles],
  )

  const analyzeGate = getAnalyzeGate(closedTrades.length)
  const canAnalyze = sessionLocked && analyzeGate.canAnalyze

  const filtersActive =
    filters.side !== 'all' ||
    filters.timeFrom !== '' ||
    filters.timeTo !== '' ||
    filters.qtyMin !== '' ||
    filters.qtyMax !== ''

  async function runAnalyze() {
    if (!canAnalyze) {
      return
    }

    coachAbortRef.current?.abort()
    const controller = new AbortController()
    coachAbortRef.current = controller
    setCoachState({ status: 'loading' })

    try {
      const result = await fetchCoachAnalyze({
        closedTrades: mapClosedTradesForCoach(closedTrades),
        signal: controller.signal,
      })
      setCoachState({ status: 'success', result })
    } catch (err) {
      if (controller.signal.aborted) {
        return
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Coach analysis failed.'
      setCoachState({ status: 'error', message })
    } finally {
      if (coachAbortRef.current === controller) {
        coachAbortRef.current = null
      }
    }
  }

  if (!sessionLocked) {
    return (
      <div className="diary-page">
        <header className="dashboard-header">
          <h1>Trader&apos;s Diary</h1>
          <p>Lock a session with Play before opening the diary.</p>
          <Link className="diary-back" to="/">
            Back to sim
          </Link>
        </header>
      </div>
    )
  }

  return (
    <div className="diary-page">
      <header className="dashboard-header">
        <h1>Trader&apos;s Diary</h1>
        <p>
          Review the revealed session chart with economic buy/sell markers.
          {playing ? ' Pausing playback…' : ' Playback paused.'}
        </p>
        <Link className="diary-back" to="/">
          Back to sim
        </Link>
      </header>

      <ul className="diary-legend" aria-label="Marker legend">
        <li>
          <span
            className="diary-legend-swatch diary-legend-buy"
            style={{ color: BUY_MARKER_COLOR }}
            aria-hidden="true"
          >
            ▲
          </span>
          Buy — arrow up below the bar (long entry / short exit)
        </li>
        <li>
          <span
            className="diary-legend-swatch diary-legend-sell"
            style={{ color: SELL_MARKER_COLOR }}
            aria-hidden="true"
          >
            ▼
          </span>
          Sell — arrow down above the bar (short entry / long exit)
        </li>
        <li>
          <span className="diary-legend-span" aria-hidden="true" />
          Position span — 40% opacity line from entry price to exit price
        </li>
      </ul>

      <form
        className="diary-filters"
        aria-label="Diary filters"
        onSubmit={(e) => e.preventDefault()}
      >
        <label>
          Side
          <select
            value={filters.side}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                side: e.target.value as SideFilter,
              }))
            }
          >
            <option value="all">All</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>

        <label>
          From
          <input
            type="date"
            value={filters.timeFrom}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, timeFrom: e.target.value }))
            }
          />
        </label>

        <label>
          To
          <input
            type="date"
            value={filters.timeTo}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, timeTo: e.target.value }))
            }
          />
        </label>

        <label>
          Qty min
          <input
            type="number"
            min={0}
            step="any"
            value={filters.qtyMin}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, qtyMin: e.target.value }))
            }
            placeholder="Any"
          />
        </label>

        <label>
          Qty max
          <input
            type="number"
            min={0}
            step="any"
            value={filters.qtyMax}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, qtyMax: e.target.value }))
            }
            placeholder="Any"
          />
        </label>

        <button
          type="button"
          className="diary-filters-reset"
          onClick={() => setFilters(EMPTY_FILTERS)}
          disabled={!filtersActive}
        >
          Reset
        </button>
      </form>

      <p className="diary-summary" aria-live="polite">
        {closedTrades.length === 0 && lots.length === 0
          ? 'No closed trades or open lots yet — chart shows the revealed session prefix.'
          : filtersActive
            ? `Showing ${filteredClosed.length}/${closedTrades.length} closed, ${filteredLots.length}/${lots.length} open · ${markers.length} marker(s).`
            : `${closedTrades.length} closed trade(s), ${lots.length} open lot(s), ${markers.length} marker(s) on chart.`}
      </p>

      <TradingChart
        candles={visibleCandles}
        markers={markers}
        tradeSpans={tradeSpans}
      />

      <CoachAnalyzePanel
        canAnalyze={canAnalyze}
        hint={analyzeGate.hint}
        state={coachState}
        onAnalyze={() => {
          void runAnalyze()
        }}
      />

      <ClosedTradesList
        trades={filteredClosed}
        emptyLabel={
          closedTrades.length === 0
            ? 'No closed trades yet.'
            : 'No closed trades match the filters.'
        }
      />
      <OpenLotsList
        lots={filteredLots}
        emptyLabel={
          lots.length === 0
            ? 'No open lots.'
            : 'No open lots match the filters.'
        }
      />
    </div>
  )
}

function CoachAnalyzePanel({
  canAnalyze,
  hint,
  state,
  onAnalyze,
}: {
  canAnalyze: boolean
  hint: string
  state: CoachPanelState
  onAnalyze: () => void
}) {
  const loading = state.status === 'loading'

  return (
    <section className="diary-coach diary-trades" aria-label="AI coach analysis">
      <h2>AI Verdict / Analysis</h2>
      <div className="diary-coach-actions">
        <button
          type="button"
          className="diary-coach-analyze"
          disabled={!canAnalyze || loading}
          onClick={onAnalyze}
        >
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
        {!canAnalyze && hint ? (
          <p className="diary-coach-hint">{hint}</p>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <p className="diary-coach-status" aria-live="polite">
          Running rules and requesting coaching analysis…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <div className="diary-coach-error" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            className="diary-coach-retry"
            disabled={!canAnalyze || loading}
            onClick={onAnalyze}
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.status === 'success' ? (
        <div className="diary-coach-result">
          <div className="diary-coach-block">
            <h3>Verdict</h3>
            <p>{state.result.verdict}</p>
          </div>
          <div className="diary-coach-block">
            <h3>Analysis</h3>
            <p className="diary-coach-analysis">{state.result.analysis}</p>
          </div>
          <div className="diary-coach-block">
            <h3>Rule findings</h3>
            {state.result.findings.length === 0 ? (
              <p className="empty-hint">No rule findings for this batch.</p>
            ) : (
              <ul className="diary-coach-findings">
                {state.result.findings.map((finding) => (
                  <li key={finding.id}>
                    <span className="diary-coach-finding-id">{finding.id}</span>
                    <span className="diary-coach-finding-sev">
                      {finding.severity}
                    </span>
                    <span>{finding.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ClosedTradesList({
  trades,
  emptyLabel,
}: {
  trades: ClosedTrade[]
  emptyLabel: string
}) {
  return (
    <section className="closed-trades diary-trades" aria-label="Closed trades">
      <h2>Closed trades</h2>
      {trades.length === 0 ? (
        <p className="empty-hint">{emptyLabel}</p>
      ) : (
        <div className="trades-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th scope="col">Qty</th>
                <th scope="col">Entry</th>
                <th scope="col">Exit</th>
                <th scope="col">Opened</th>
                <th scope="col">Closed</th>
                <th scope="col">PnL</th>
                <th scope="col">PnL %</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const pct = pnlPercent(
                  trade.realizedPnl,
                  trade.entryPrice,
                  trade.qty,
                )
                return (
                  <tr key={trade.id}>
                    <td>{trade.side}</td>
                    <td>{formatPrice(trade.qty)}</td>
                    <td>{formatPrice(trade.entryPrice)}</td>
                    <td>{formatPrice(trade.exitPrice)}</td>
                    <td>{formatTime(trade.entryTime)}</td>
                    <td>{formatTime(trade.exitTime)}</td>
                    <td
                      className={
                        trade.realizedPnl > 0
                          ? 'pnl-positive'
                          : trade.realizedPnl < 0
                            ? 'pnl-negative'
                            : undefined
                      }
                    >
                      {formatPnl(trade.realizedPnl)}
                    </td>
                    <td>{pct == null ? '—' : formatPnlPercent(pct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function OpenLotsList({
  lots,
  emptyLabel,
}: {
  lots: Lot[]
  emptyLabel: string
}) {
  return (
    <section className="open-trades diary-trades" aria-label="Open lots">
      <h2>Open lots</h2>
      {lots.length === 0 ? (
        <p className="empty-hint">{emptyLabel}</p>
      ) : (
        <div className="trades-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th scope="col">Qty</th>
                <th scope="col">Entry</th>
                <th scope="col">Opened</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr key={lot.id}>
                  <td>{lot.side}</td>
                  <td>{formatPrice(lot.qty)}</td>
                  <td>{formatPrice(lot.entryPrice)}</td>
                  <td>{formatTime(lot.entryTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
