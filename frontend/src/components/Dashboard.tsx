import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  advancePlayhead,
  delayForSpeed,
  initialPlayhead,
  isAtEnd,
  resolveSessionStartIndex,
  type PlaybackSpeed,
} from '../playback'
import { ApiError, fetchByBitCandles, type MarketData } from '../services/api'
import {
  accountBalance,
  cancelOrder,
  closeAll,
  closeLotById,
  closeQtyFifo,
  markFromCandles,
  matchLimits,
  netSides,
  nextTradingId,
  openMarket,
  placeLimitOrder,
  placeStopOrder,
  qtyFromPercent,
  realizedPnl as calcUnrealizedPnl,
  validateQtyAgainstSoftCap,
  type ClosedTrade,
  type Lot,
  type Order,
  type Side,
} from '../trading'
import TradingChart from './TradingChart'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
const SPEEDS: PlaybackSpeed[] = [1, 2, 5]
const DEFAULT_STARTING_BALANCE = 10_000

type SizingMode = 'qty' | 'percent'
type OrderTicketType = 'market' | 'limit'

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

/** `YYYY-MM-DD` for `<input type="date">` from an ISO timestamp. */
function toDateInputValue(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) {
    return ''
  }
  return new Date(ms).toISOString().slice(0, 10)
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

function emptyTradingState() {
  return {
    lots: [] as Lot[],
    pendingOrders: [] as Order[],
    closedTrades: [] as ClosedTrade[],
    realizedPnl: 0,
  }
}

export default function Dashboard() {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState<string>('1h')
  const [candles, setCandles] = useState<MarketData[]>([])
  const [sessionStartDate, setSessionStartDate] = useState('')
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [sessionLocked, setSessionLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tradeMessage, setTradeMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [startingBalance, setStartingBalance] = useState(DEFAULT_STARTING_BALANCE)
  const [lots, setLots] = useState<Lot[]>([])
  const [pendingOrders, setPendingOrders] = useState<Order[]>([])
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([])
  const [realizedPnl, setRealizedPnl] = useState(0)

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

  const loadAbortRef = useRef<AbortController | null>(null)
  const playheadRef = useRef(playhead)
  const candlesRef = useRef(candles)
  const tradingRef = useRef({
    lots,
    pendingOrders,
    closedTrades,
    realizedPnl,
    startingBalance,
  })

  const sessionStartIndex =
    candles.length === 0
      ? 0
      : resolveSessionStartIndex(
          candles,
          sessionStartDate || candles[0]!.timestamp,
        )
  const visibleCandles = candles.slice(sessionStartIndex, playhead)
  const atEnd = isAtEnd(playhead, candles.length)
  const hasCandles = candles.length > 0
  const mark = markFromCandles(visibleCandles)
  const balance = accountBalance({ startingBalance, realizedPnl })
  const nets = netSides(lots)
  const canTrade = sessionLocked && mark != null

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    playheadRef.current = playhead
  }, [playhead])

  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

  useEffect(() => {
    tradingRef.current = {
      lots,
      pendingOrders,
      closedTrades,
      realizedPnl,
      startingBalance,
    }
  }, [lots, pendingOrders, closedTrades, realizedPnl, startingBalance])

  const applyLimitMatchRef = useRef((newBar: MarketData) => {
    const current = tradingRef.current
    if (current.pendingOrders.length === 0) {
      return
    }
    const paperBalance = current.startingBalance + current.realizedPnl
    const matched = matchLimits({
      orders: current.pendingOrders,
      lots: current.lots,
      bar: newBar,
      balance: paperBalance,
    })

    tradingRef.current = {
      ...current,
      lots: matched.lots,
      pendingOrders: matched.orders,
      closedTrades: [...current.closedTrades, ...matched.closedTrades],
      realizedPnl: current.realizedPnl + matched.realizedPnlDelta,
    }

    setLots(matched.lots)
    setPendingOrders(matched.orders)
    if (matched.closedTrades.length > 0) {
      setClosedTrades((prev) => [...prev, ...matched.closedTrades])
    }
    if (matched.realizedPnlDelta !== 0) {
      setRealizedPnl((prev) => prev + matched.realizedPnlDelta)
    }
    if (matched.cancelled.length > 0) {
      const ids = matched.cancelled.map((c) => c.order.id).join(', ')
      setTradeMessage(
        `Limit order(s) cancelled (soft cap at fill): ${ids}`,
      )
    } else if (matched.filled.length > 0) {
      setTradeMessage(
        `Filled ${matched.filled.length} limit order(s) on new bar.`,
      )
    }
  })

  // Wall-clock playback tick; delay retargets when speed changes while playing.
  // Limit matching runs once per successful playhead +1 against the newly revealed bar.
  useEffect(() => {
    if (!playing) {
      return
    }

    const length = candles.length
    const timerId = window.setInterval(() => {
      const previous = playheadRef.current
      const result = advancePlayhead(previous, length)
      if (result.playhead > previous) {
        const newBar = candlesRef.current[result.playhead - 1]
        if (newBar) {
          applyLimitMatchRef.current(newBar)
        }
      }
      setPlayhead(result.playhead)
      if (result.kind === 'atEnd') {
        setPlaying(false)
      }
    }, delayForSpeed(speed))

    return () => {
      window.clearInterval(timerId)
    }
  }, [playing, speed, candles.length])

  function syncTradingRef(
    patch: Partial<{
      lots: Lot[]
      pendingOrders: Order[]
      closedTrades: ClosedTrade[]
      realizedPnl: number
      startingBalance: number
    }>,
  ) {
    tradingRef.current = { ...tradingRef.current, ...patch }
  }

  function resetTrading() {
    const empty = emptyTradingState()
    setLots(empty.lots)
    setPendingOrders(empty.pendingOrders)
    setClosedTrades(empty.closedTrades)
    setRealizedPnl(empty.realizedPnl)
    setTradeMessage(null)
    syncTradingRef({
      lots: empty.lots,
      pendingOrders: empty.pendingOrders,
      closedTrades: empty.closedTrades,
      realizedPnl: empty.realizedPnl,
      startingBalance,
    })
  }

  function resetSessionFromCandles(data: MarketData[], startDate: string) {
    const startIndex =
      data.length === 0 ? 0 : resolveSessionStartIndex(data, startDate)
    setCandles(data)
    setSessionStartDate(startDate)
    setPlayhead(initialPlayhead(startIndex, data.length))
    setPlaying(false)
    resetTrading()
  }

  function handleSessionStartDateChange(nextDate: string) {
    if (sessionLocked || candles.length === 0) {
      return
    }
    const startIndex = resolveSessionStartIndex(candles, nextDate)
    setSessionStartDate(nextDate)
    setPlayhead(initialPlayhead(startIndex, candles.length))
    setPlaying(false)
  }

  function handlePlay() {
    if (!hasCandles || atEnd || playing) {
      return
    }
    setSessionLocked(true)
    setPlaying(true)
  }

  function handlePause() {
    setPlaying(false)
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
    if (!canTrade || !mark) {
      setTradeMessage(
        sessionLocked
          ? 'Cannot trade without a mark candle.'
          : 'Play once to lock the session before trading.',
      )
      return
    }

    const sized = resolveOpenQty()
    if (!sized.ok) {
      setTradeMessage(sized.message)
      return
    }

    if (ticketType === 'market') {
      const opened = openMarket({
        lots,
        side: ticketSide,
        qty: sized.qty,
        markPrice: mark.markPrice,
        markTime: mark.markTime,
        balance,
      })
      if (!opened.ok) {
        setTradeMessage(opened.message)
        return
      }
      setLots(opened.lots)
      syncTradingRef({ lots: opened.lots })
      setTradeMessage(
        `Opened ${ticketSide} market qty ${formatPrice(sized.qty)} @ ${formatPrice(mark.markPrice)}.`,
      )
      return
    }

    const limitPrice = Number(limitPriceInput)
    if (!(limitPrice > 0)) {
      setTradeMessage('Limit price must be positive.')
      return
    }
    const order: Order = {
      id: nextTradingId('ord'),
      side: ticketSide,
      intent: 'open',
      type: 'limit',
      qty: sized.qty,
      limitPrice,
      createdAt: mark.markTime,
    }
    const nextOrders = placeLimitOrder(pendingOrders, order)
    setPendingOrders(nextOrders)
    syncTradingRef({ pendingOrders: nextOrders })
    setTradeMessage(
      `Resting ${ticketSide} limit open qty ${formatPrice(sized.qty)} @ ${formatPrice(limitPrice)}.`,
    )
  }

  function availableQty(side: Side): number {
    return side === 'long' ? nets.long.qty : nets.short.qty
  }

  function handleMarketClose(event: FormEvent) {
    event.preventDefault()
    if (!canTrade || !mark) {
      setTradeMessage('Cannot close — session locked with a mark candle required.')
      return
    }
    const qty = Number(closeQtyInput)
    if (!(qty > 0)) {
      setTradeMessage('Close qty must be positive.')
      return
    }
    const closed = closeQtyFifo(
      lots,
      closeSide,
      qty,
      mark.markPrice,
      mark.markTime,
    )
    if (!closed.ok) {
      setTradeMessage(closed.message)
      return
    }
    const nextTrades = [...closedTrades, ...closed.closedTrades]
    const nextPnl = realizedPnl + closed.realizedPnl
    setLots(closed.lots)
    setClosedTrades(nextTrades)
    setRealizedPnl(nextPnl)
    syncTradingRef({
      lots: closed.lots,
      closedTrades: nextTrades,
      realizedPnl: nextPnl,
    })
    setTradeMessage(
      `Market closed ${closeSide} qty ${formatPrice(qty)} FIFO @ ${formatPrice(mark.markPrice)} (PnL ${formatPnl(closed.realizedPnl)}).`,
    )
  }

  function handleCloseOpenLot(lotId: string) {
    if (!canTrade || !mark) {
      setTradeMessage('Cannot close — session locked with a mark candle required.')
      return
    }
    const closed = closeLotById({
      lots,
      lotId,
      exitPrice: mark.markPrice,
      exitTime: mark.markTime,
    })
    if (!closed.ok) {
      setTradeMessage(closed.message)
      return
    }
    const nextTrades = [...closedTrades, closed.closedTrade]
    const nextPnl = realizedPnl + closed.realizedPnl
    setLots(closed.lots)
    setClosedTrades(nextTrades)
    setRealizedPnl(nextPnl)
    syncTradingRef({
      lots: closed.lots,
      closedTrades: nextTrades,
      realizedPnl: nextPnl,
    })
    setTradeMessage(
      `Closed ${closed.closedTrade.side} qty ${formatPrice(closed.closedTrade.qty)} @ ${formatPrice(mark.markPrice)} (PnL ${formatPnl(closed.realizedPnl)}).`,
    )
  }

  function handleCloseAll() {
    if (!canTrade || !mark) {
      setTradeMessage('Cannot close — session locked with a mark candle required.')
      return
    }
    if (lots.length === 0) {
      setTradeMessage('Already flat — nothing to close.')
      return
    }
    const flattened = closeAll({
      lots,
      exitPrice: mark.markPrice,
      exitTime: mark.markTime,
    })
    const nextTrades = [...closedTrades, ...flattened.closedTrades]
    const nextPnl = realizedPnl + flattened.realizedPnl
    setLots(flattened.lots)
    setClosedTrades(nextTrades)
    setRealizedPnl(nextPnl)
    syncTradingRef({
      lots: flattened.lots,
      closedTrades: nextTrades,
      realizedPnl: nextPnl,
    })
    setTradeMessage(
      `Closed all (${flattened.closedTrades.length} lots) @ ${formatPrice(mark.markPrice)} (PnL ${formatPnl(flattened.realizedPnl)}).`,
    )
  }

  function handleTakeProfitSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canTrade || !mark) {
      setTradeMessage('Cannot place take profit — lock session and wait for mark.')
      return
    }
    const limitPrice = Number(tpPriceInput)
    const qty = Number(tpQtyInput)
    if (!(limitPrice > 0) || !(qty > 0)) {
      setTradeMessage('Take profit price and qty must be positive.')
      return
    }
    const available = availableQty(closeSide)
    if (qty > available + 1e-12) {
      setTradeMessage(
        `TP qty ${formatPrice(qty)} exceeds ${closeSide} net ${formatPrice(available)}.`,
      )
      return
    }
    const order: Order = {
      id: nextTradingId('ord'),
      side: closeSide,
      intent: 'close',
      type: 'limit',
      qty,
      limitPrice,
      createdAt: mark.markTime,
    }
    const nextOrders = placeLimitOrder(pendingOrders, order)
    setPendingOrders(nextOrders)
    syncTradingRef({ pendingOrders: nextOrders })
    setTradeMessage(
      `Take profit ${closeSide} qty ${formatPrice(qty)} @ ${formatPrice(limitPrice)}.`,
    )
  }

  function handleStopLossSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canTrade || !mark) {
      setTradeMessage('Cannot place stop loss — lock session and wait for mark.')
      return
    }
    const stopPrice = Number(slPriceInput)
    const qty = Number(slQtyInput)
    if (!(stopPrice > 0) || !(qty > 0)) {
      setTradeMessage('Stop loss price and qty must be positive.')
      return
    }
    const available = availableQty(closeSide)
    if (qty > available + 1e-12) {
      setTradeMessage(
        `SL qty ${formatPrice(qty)} exceeds ${closeSide} net ${formatPrice(available)}.`,
      )
      return
    }
    const order: Order = {
      id: nextTradingId('ord'),
      side: closeSide,
      intent: 'close',
      type: 'stop',
      qty,
      limitPrice: stopPrice,
      createdAt: mark.markTime,
    }
    const nextOrders = placeStopOrder(pendingOrders, order)
    setPendingOrders(nextOrders)
    syncTradingRef({ pendingOrders: nextOrders })
    setTradeMessage(
      `Stop loss ${closeSide} qty ${formatPrice(qty)} @ ${formatPrice(stopPrice)}.`,
    )
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

  function handleCancelOrder(orderId: string) {
    const result = cancelOrder(pendingOrders, orderId)
    if (!result.cancelled) {
      setTradeMessage(`Order ${orderId} not found.`)
      return
    }
    setPendingOrders(result.orders)
    syncTradingRef({ pendingOrders: result.orders })
    setTradeMessage(`Cancelled order ${orderId}.`)
  }

  async function handleLoad(event: FormEvent) {
    event.preventDefault()
    if (sessionLocked) {
      return
    }

    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const data = await fetchByBitCandles({
        symbol: symbol.trim().toUpperCase(),
        interval,
        signal: controller.signal,
      })
      const defaultStart =
        data.length > 0 ? toDateInputValue(data[0]!.timestamp) : ''
      resetSessionFromCandles(data, defaultStart)
    } catch (err) {
      if (isAbortError(err)) {
        return
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load candles'
      setError(message)
      // Keep previous candles / playback / trading state on failure (non-destructive).
    } finally {
      if (loadAbortRef.current === controller) {
        setLoading(false)
      }
    }
  }

  const dateMin =
    hasCandles && candles[0] ? toDateInputValue(candles[0].timestamp) : undefined
  const dateMax =
    hasCandles && candles[candles.length - 1]
      ? toDateInputValue(candles[candles.length - 1]!.timestamp)
      : undefined

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
          Load historical ByBit spot candles before a sim session (up to 1000
          bars per load until file ingest).
        </p>
      </header>

      <form className="load-form" onSubmit={handleLoad}>
        <label>
          Symbol
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={sessionLocked || loading}
          />
        </label>

        <label>
          Interval
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            disabled={sessionLocked || loading}
          >
            {INTERVALS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={loading || sessionLocked}>
          {loading ? 'Loading…' : sessionLocked ? 'Load locked' : 'Load'}
        </button>
      </form>

      <div className="playback-controls" role="group" aria-label="Playback controls">
        <label>
          Session start
          <input
            type="date"
            value={sessionStartDate}
            min={dateMin}
            max={dateMax}
            onChange={(e) => handleSessionStartDateChange(e.target.value)}
            disabled={!hasCandles || sessionLocked}
          />
        </label>

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
        <label>
          Starting balance
          <input
            type="number"
            min={0}
            step="any"
            value={startingBalance}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (Number.isFinite(next) && next >= 0) {
                setStartingBalance(next)
              }
            }}
            disabled={sessionLocked}
          />
        </label>
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

      {tradeMessage ? (
        <p className="status status-info" role="status">
          {tradeMessage}
        </p>
      ) : null}

      <p className="status status-info">{statusText}</p>

      <TradingChart candles={visibleCandles} />
    </div>
  )
}
