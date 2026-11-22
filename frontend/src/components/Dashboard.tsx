import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { buildTradeMarkers, buildTradeSpans } from '../diary'
import { type PlaybackSpeed } from '../playback'
import { useSession } from '../session'
import {
  qtyFromPercent,
  realizedPnl as calcUnrealizedPnl,
  validateQtyAgainstSoftCap,
  type Order,
  type Side,
} from '../trading'
import TradingChart from './TradingChart'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
const SPEEDS: PlaybackSpeed[] = [1, 2, 5]

type SizingMode = 'qty' | 'percent'
type OrderTicketType = 'market' | 'limit'

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

/** PnL as % of entry notional (works for long and short via signed pnl). */
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

function pendingOrderLabel(order: Order): string {
  if (order.intent === 'close' && order.type === 'limit') {
    return 'take profit'
  }
  if (order.intent === 'close' && order.type === 'stop') {
    return 'stop loss'
  }
  if (order.intent === 'open' && order.type === 'limit') {
    return 'limit open'
  }
  if (order.intent === 'open' && order.type === 'stop') {
    return 'stop open'
  }
  return `${order.type} ${order.intent}`
}

export default function Dashboard() {
  const session = useSession()
  const {
    symbol,
    interval,
    changeInterval,
    playing,
    speed,
    sessionLocked,
    isReviewMode,
    error,
    loadWarning,
    tradeMessage,
    setTradeMessage,
    saveMessage,
    loading,
    startingBalance,
    lots,
    pendingOrders,
    closedTrades,
    realizedPnl,
    sessionStartIndex,
    visibleCandles,
    atEnd,
    hasCandles,
    mark,
    balance,
    nets,
    canTrade,
    candles,
    playhead,
    handlePlay,
    handlePause,
    setSpeed,
    saveSession,
    openMarketOrder,
    placeOpenLimit,
    marketCloseFifo,
    closeOpenLot,
    closeAllPositions,
    placeTakeProfit,
    placeStopLoss,
    cancelPendingOrder,
  } = session

  const [ticketSide, setTicketSide] = useState<Side>('long')
  const [ticketType, setTicketType] = useState<OrderTicketType>('market')
  // Default % so BTC/high mark prices are not blocked by soft notional cap at qty=1.
  const [sizingMode, setSizingMode] = useState<SizingMode>('percent')
  const [qtyInput, setQtyInput] = useState('0.01')
  const [percentInput, setPercentInput] = useState('10')
  const [limitPriceInput, setLimitPriceInput] = useState('')
  const [closeSide, setCloseSide] = useState<Side>('long')
  const [closeQtyInput, setCloseQtyInput] = useState('0.01')
  const [tpPriceInput, setTpPriceInput] = useState('')
  const [tpQtyInput, setTpQtyInput] = useState('0.01')
  const [slPriceInput, setSlPriceInput] = useState('')
  const [slQtyInput, setSlQtyInput] = useState('0.01')

  const chartMarkers = useMemo(
    () => buildTradeMarkers(closedTrades, lots, visibleCandles),
    [closedTrades, lots, visibleCandles],
  )
  const chartTradeSpans = useMemo(
    () => buildTradeSpans(closedTrades, visibleCandles),
    [closedTrades, visibleCandles],
  )

  if (!sessionLocked || isReviewMode) {
    return <Navigate to="/" replace />
  }

  function resolveOpenQty():
    | { ok: true; qty: number }
    | { ok: false; message: string } {
    if (!mark) {
      return { ok: false, message: 'No mark price — wait for visible candles.' }
    }
    if (sizingMode === 'percent') {
      const percent = Number(percentInput)
      const sized = qtyFromPercent(balance, percent, mark.markPrice)
      if (!sized.ok) {
        return { ok: false, message: sized.message }
      }
      return { ok: true, qty: sized.qty }
    }
    const qty = Number(qtyInput)
    const sized = validateQtyAgainstSoftCap(qty, mark.markPrice, balance)
    if (!sized.ok) {
      return { ok: false, message: sized.message }
    }
    return { ok: true, qty: sized.qty }
  }

  function handleOpenSubmit(event: FormEvent) {
    event.preventDefault()
    const sized = resolveOpenQty()
    if (!sized.ok) {
      setTradeMessage(sized.message)
      return
    }

    if (ticketType === 'market') {
      const opened = openMarketOrder({ side: ticketSide, qty: sized.qty })
      if (!opened.ok) {
        setTradeMessage(opened.message)
        return
      }
      setTradeMessage(
        `Opened ${ticketSide} market qty ${formatPrice(sized.qty)} @ ${formatPrice(mark!.markPrice)}.`,
      )
      return
    }

    const limitPrice = Number(limitPriceInput)
    const placed = placeOpenLimit({
      side: ticketSide,
      qty: sized.qty,
      limitPrice,
    })
    if (!placed.ok) {
      setTradeMessage(placed.message)
      return
    }
    setTradeMessage(
      `Resting ${ticketSide} limit open qty ${formatPrice(sized.qty)} @ ${formatPrice(limitPrice)}.`,
    )
  }

  function handleMarketClose(event: FormEvent) {
    event.preventDefault()
    const qty = Number(closeQtyInput)
    const closed = marketCloseFifo({ side: closeSide, qty })
    if (!closed.ok) {
      setTradeMessage(closed.message)
      return
    }
    setTradeMessage(
      `Market closed ${closeSide} qty ${formatPrice(qty)} FIFO @ ${formatPrice(mark!.markPrice)} (PnL ${formatPnl(closed.realizedPnl)}).`,
    )
  }

  function handleCloseOpenLot(lotId: string) {
    const closed = closeOpenLot(lotId)
    if (!closed.ok) {
      setTradeMessage(closed.message)
      return
    }
    setTradeMessage(
      `Closed ${closed.side} qty ${formatPrice(closed.qty)} @ ${formatPrice(mark!.markPrice)} (PnL ${formatPnl(closed.realizedPnl)}).`,
    )
  }

  function handleCloseAll() {
    const flattened = closeAllPositions()
    if (!flattened.ok) {
      setTradeMessage(flattened.message)
      return
    }
    setTradeMessage(
      `Closed all (${flattened.closedCount} lots) @ ${formatPrice(mark!.markPrice)} (PnL ${formatPnl(flattened.realizedPnl)}).`,
    )
  }

  function handleTakeProfitSubmit(event: FormEvent) {
    event.preventDefault()
    const limitPrice = Number(tpPriceInput)
    const qty = Number(tpQtyInput)
    const placed = placeTakeProfit({ side: closeSide, qty, limitPrice })
    if (!placed.ok) {
      setTradeMessage(
        placed.message.includes('exceeds')
          ? `TP qty ${formatPrice(qty)} exceeds ${closeSide} net ${formatPrice(session.availableQty(closeSide))}.`
          : placed.message,
      )
      return
    }
    setTradeMessage(
      `Take profit ${closeSide} qty ${formatPrice(qty)} @ ${formatPrice(limitPrice)}.`,
    )
  }

  function handleStopLossSubmit(event: FormEvent) {
    event.preventDefault()
    const stopPrice = Number(slPriceInput)
    const qty = Number(slQtyInput)
    const placed = placeStopLoss({ side: closeSide, qty, stopPrice })
    if (!placed.ok) {
      setTradeMessage(
        placed.message.includes('exceeds')
          ? `SL qty ${formatPrice(qty)} exceeds ${closeSide} net ${formatPrice(session.availableQty(closeSide))}.`
          : placed.message,
      )
      return
    }
    setTradeMessage(
      `Stop loss ${closeSide} qty ${formatPrice(qty)} @ ${formatPrice(stopPrice)}.`,
    )
  }

  function handleCancelOrder(orderId: string) {
    const result = cancelPendingOrder(orderId)
    if (!result.ok) {
      setTradeMessage(result.message)
      return
    }
    setTradeMessage(`Cancelled order ${orderId}.`)
  }

  const statusText = (() => {
    if (!hasCandles) {
      return 'No candles loaded yet.'
    }
    const symbolLabel = candles[0]?.symbol ?? symbol
    const intervalLabel = candles[0]?.interval ?? interval
    const visibleCount = Math.max(0, playhead - sessionStartIndex)
    const lockLabel = sessionLocked ? 'session locked' : 'session unlocked'
    const playLabel = playing ? 'playing' : atEnd ? 'at end (paused)' : 'paused'
    const markLabel = mark
      ? `mark ${formatPrice(mark.markPrice)}`
      : 'no mark'
    return `Loaded ${candles.length} candles (${symbolLabel} ${intervalLabel}). Showing ${visibleCount} from session start — ${playLabel}, ${lockLabel}, ${markLabel}.`
  })()

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>TradingTutor</h1>
        <p>
          Paper session in progress. Switch chart timeframe during play — lower
          TFs are downloaded on demand and may not reach as far back as higher
          ones.
        </p>
        <div className="dashboard-header-actions">
          <Link className="diary-cta" to="/">
            Session setup
          </Link>
          <Link className="diary-cta" to="/diary">
            Open Trader&apos;s Diary
          </Link>
        </div>
      </header>

      <div className="load-form" role="group" aria-label="Chart timeframe">
        <label>
          Chart interval
          <select
            value={interval}
            onChange={(e) => changeInterval(e.target.value)}
            disabled={loading}
            aria-label="Chart interval"
          >
            {INTERVALS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <p className="load-form-hint">
          Tip: stay on a higher TF, then switch lower to refine an entry. If the
          lower TF has no history at the current play time, the switch is
          blocked with an explanation.
        </p>
      </div>

      <div className="playback-controls" role="group" aria-label="Playback controls">
        <label>
          Speed
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as PlaybackSpeed)}
            disabled={!hasCandles}
            aria-label="Playback speed"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handlePlay}
          disabled={!hasCandles || playing || atEnd}
          aria-label="Play"
        >
          Play
        </button>

        <button
          type="button"
          onClick={handlePause}
          disabled={!playing}
          aria-label="Pause"
        >
          Pause
        </button>
      </div>

      <div className="account-strip" role="group" aria-label="Paper account">
        <p className="account-balance" aria-live="polite">
          Balance:{' '}
          <strong>{formatPrice(balance)}</strong>
          <span className="account-balance-detail">
            {' '}
            (start {formatPrice(startingBalance)} + realized{' '}
            {formatPnl(realizedPnl)})
          </span>
        </p>
        <p className="position-summary" aria-live="polite">
          Net Long:{' '}
          {nets.long.qty > 0
            ? `${formatPrice(nets.long.qty)} @ ${formatPrice(nets.long.avgEntry)}`
            : 'flat'}
          {' · '}
          Net Short:{' '}
          {nets.short.qty > 0
            ? `${formatPrice(nets.short.qty)} @ ${formatPrice(nets.short.avgEntry)}`
            : 'flat'}
        </p>
        <button
          type="button"
          onClick={() => {
            void saveSession()
          }}
          disabled={loading}
          aria-label="Save session"
        >
          {loading ? 'Saving…' : 'Save session'}
        </button>
        {saveMessage ? (
          <p className="save-message" aria-live="polite">
            {saveMessage}
          </p>
        ) : null}
      </div>

      <form
        className="trade-ticket"
        onSubmit={handleOpenSubmit}
        aria-label="Order ticket"
      >
        <label>
          Side
          <select
            value={ticketSide}
            onChange={(e) => setTicketSide(e.target.value as Side)}
            disabled={!canTrade}
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>

        <label>
          Type
          <select
            value={ticketType}
            onChange={(e) => setTicketType(e.target.value as OrderTicketType)}
            disabled={!canTrade}
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </label>

        <label>
          Size by
          <select
            value={sizingMode}
            onChange={(e) => setSizingMode(e.target.value as SizingMode)}
            disabled={!canTrade}
          >
            <option value="qty">Qty</option>
            <option value="percent">% of wallet</option>
          </select>
        </label>

        {sizingMode === 'qty' ? (
          <label>
            Qty
            <input
              type="number"
              min={0}
              step="any"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              disabled={!canTrade}
            />
          </label>
        ) : (
          <label>
            Percent
            <input
              type="number"
              min={0}
              step="any"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              disabled={!canTrade}
            />
          </label>
        )}

        {ticketType === 'limit' ? (
          <label>
            Limit price
            <input
              type="number"
              min={0}
              step="any"
              value={limitPriceInput}
              onChange={(e) => setLimitPriceInput(e.target.value)}
              disabled={!canTrade}
              placeholder={mark ? String(mark.markPrice) : undefined}
            />
          </label>
        ) : null}

        <button type="submit" disabled={!canTrade}>
          Open
        </button>
        {mark ? (
          <p className="mark-hint">
            Market fills @ last visible close:{' '}
            <strong>{formatPrice(mark.markPrice)}</strong>
          </p>
        ) : (
          <p className="mark-hint">Play once to unlock trading.</p>
        )}
      </form>

      <div className="close-controls" role="group" aria-label="Close controls">
        <label>
          Side
          <select
            value={closeSide}
            onChange={(e) => setCloseSide(e.target.value as Side)}
            disabled={!canTrade}
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>

        <form className="close-market-form" onSubmit={handleMarketClose}>
          <label>
            Close qty
            <input
              type="number"
              min={0}
              step="any"
              value={closeQtyInput}
              onChange={(e) => setCloseQtyInput(e.target.value)}
              disabled={!canTrade}
            />
          </label>
          <button type="submit" disabled={!canTrade}>
            Close
          </button>
        </form>

        <button type="button" onClick={handleCloseAll} disabled={!canTrade}>
          Close all
        </button>

        <form className="close-limit-form" onSubmit={handleTakeProfitSubmit}>
          <label>
            Take profit price
            <input
              type="number"
              min={0}
              step="any"
              value={tpPriceInput}
              onChange={(e) => setTpPriceInput(e.target.value)}
              disabled={!canTrade}
              placeholder={mark ? String(mark.markPrice) : undefined}
            />
          </label>
          <label>
            TP qty
            <input
              type="number"
              min={0}
              step="any"
              value={tpQtyInput}
              onChange={(e) => setTpQtyInput(e.target.value)}
              disabled={!canTrade}
            />
          </label>
          <button type="submit" disabled={!canTrade}>
            Place take profit
          </button>
        </form>

        <form className="close-stop-form" onSubmit={handleStopLossSubmit}>
          <label>
            Stop loss price
            <input
              type="number"
              min={0}
              step="any"
              value={slPriceInput}
              onChange={(e) => setSlPriceInput(e.target.value)}
              disabled={!canTrade}
              placeholder={mark ? String(mark.markPrice) : undefined}
            />
          </label>
          <label>
            SL qty
            <input
              type="number"
              min={0}
              step="any"
              value={slQtyInput}
              onChange={(e) => setSlQtyInput(e.target.value)}
              disabled={!canTrade}
            />
          </label>
          <button type="submit" disabled={!canTrade}>
            Place stop loss
          </button>
        </form>
      </div>

      <section className="pending-orders" aria-label="Pending orders">
        <h2>Pending orders</h2>
        {pendingOrders.length === 0 ? (
          <p className="empty-hint">No resting TP / SL / limits.</p>
        ) : (
          <ul>
            {pendingOrders.map((order) => (
              <li key={order.id}>
                <span>
                  {order.id}: {pendingOrderLabel(order)} {order.side} qty{' '}
                  {formatPrice(order.qty)}
                  {order.limitPrice != null
                    ? ` @ ${formatPrice(order.limitPrice)}`
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => handleCancelOrder(order.id)}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="open-trades" aria-label="Open trades">
        <h2>Open trades</h2>
        {lots.length === 0 ? (
          <p className="empty-hint">No open trades.</p>
        ) : (
          <div className="trades-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Side</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Mark</th>
                  <th scope="col">Entry time</th>
                  <th scope="col">Unrealized</th>
                  <th scope="col">PnL %</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => {
                  const markPrice = mark?.markPrice
                  const unrealized =
                    markPrice == null
                      ? null
                      : calcUnrealizedPnl(
                          lot.side,
                          lot.qty,
                          lot.entryPrice,
                          markPrice,
                        )
                  const pct =
                    unrealized == null
                      ? null
                      : pnlPercent(unrealized, lot.entryPrice, lot.qty)
                  return (
                    <tr key={lot.id}>
                      <td>{lot.side}</td>
                      <td>{formatPrice(lot.qty)}</td>
                      <td>{formatPrice(lot.entryPrice)}</td>
                      <td>
                        {markPrice == null ? '—' : formatPrice(markPrice)}
                      </td>
                      <td>{lot.entryTime}</td>
                      <td>
                        {unrealized == null ? '—' : formatPnl(unrealized)}
                      </td>
                      <td>{pct == null ? '—' : formatPnlPercent(pct)}</td>
                      <td>
                        <button
                          type="button"
                          className="trade-row-action"
                          onClick={() => handleCloseOpenLot(lot.id)}
                          disabled={!canTrade}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="closed-trades" aria-label="Closed trades">
        <h2>Closed trades</h2>
        {closedTrades.length === 0 ? (
          <p className="empty-hint">No closed trades yet.</p>
        ) : (
          <div className="trades-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Side</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Exit</th>
                  <th scope="col">Entry time</th>
                  <th scope="col">Exit time</th>
                  <th scope="col">PnL</th>
                  <th scope="col">PnL %</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((trade) => {
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
                      <td>{trade.entryTime}</td>
                      <td>{trade.exitTime}</td>
                      <td>{formatPnl(trade.realizedPnl)}</td>
                      <td>{pct == null ? '—' : formatPnlPercent(pct)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error ? (
        <p className="status status-error" role="alert">
          {error}
        </p>
      ) : null}

      {loadWarning ? (
        <p
          className={
            loadWarning.includes('Warning:')
              ? 'status status-warning'
              : 'status status-info'
          }
          role="status"
        >
          {loadWarning}
        </p>
      ) : null}

      {tradeMessage ? (
        <p className="status status-info" role="status">
          {tradeMessage}
        </p>
      ) : null}

      <p className="status status-info">{statusText}</p>

      <TradingChart
        candles={visibleCandles}
        markers={chartMarkers}
        tradeSpans={chartTradeSpans}
      />
    </div>
  )
}
