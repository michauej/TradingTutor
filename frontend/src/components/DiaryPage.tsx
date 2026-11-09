import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BUY_MARKER_COLOR,
  SELL_MARKER_COLOR,
  buildTradeMarkers,
  buildTradeSpans,
} from '../diary'
import { useSession } from '../session'
import type { ClosedTrade, Lot, Side } from '../trading'
import TradingChart from './TradingChart'

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

  // Pause once on diary entry; do not auto-resume when returning to sim.
  useEffect(() => {
    handlePause()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only pause
  }, [])

  const filteredClosed = useMemo(
    () => filterClosedTrades(closedTrades, filters),
    [closedTrades, filters],
  )
  const filteredLots = useMemo(
    () => filterOpenLots(lots, filters),
    [lots, filters],
  )

  const markers = buildTradeMarkers(
    filteredClosed,
    filteredLots,
    visibleCandles,
  )
  const tradeSpans = buildTradeSpans(filteredClosed, visibleCandles)

  const filtersActive =
    filters.side !== 'all' ||
    filters.timeFrom !== '' ||
    filters.timeTo !== '' ||
    filters.qtyMin !== '' ||
    filters.qtyMax !== ''

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
