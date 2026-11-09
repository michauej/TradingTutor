import {
  createContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
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
  type ClosedTrade,
  type Lot,
  type Order,
  type Side,
} from '../trading'

const DEFAULT_STARTING_BALANCE = 10_000

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

function emptyTradingState() {
  return {
    lots: [] as Lot[],
    pendingOrders: [] as Order[],
    closedTrades: [] as ClosedTrade[],
    realizedPnl: 0,
  }
}

export interface SessionContextValue {
  symbol: string
  setSymbol: (value: string) => void
  interval: string
  setInterval: (value: string) => void
  candles: MarketData[]
  sessionStartDate: string
  playhead: number
  playing: boolean
  speed: PlaybackSpeed
  sessionLocked: boolean
  error: string | null
  tradeMessage: string | null
  setTradeMessage: (value: string | null) => void
  loading: boolean
  startingBalance: number
  setStartingBalance: (value: number) => void
  lots: Lot[]
  pendingOrders: Order[]
  closedTrades: ClosedTrade[]
  realizedPnl: number
  sessionStartIndex: number
  visibleCandles: MarketData[]
  atEnd: boolean
  hasCandles: boolean
  mark: ReturnType<typeof markFromCandles>
  balance: number
  nets: ReturnType<typeof netSides>
  canTrade: boolean
  dateMin: string | undefined
  dateMax: string | undefined
  handleLoad: (event: FormEvent) => Promise<void>
  handleSessionStartDateChange: (nextDate: string) => void
  handlePlay: () => void
  handlePause: () => void
  setSpeed: (speed: PlaybackSpeed) => void
  openMarketOrder: (params: {
    side: Side
    qty: number
  }) => { ok: true } | { ok: false; message: string }
  placeOpenLimit: (params: {
    side: Side
    qty: number
    limitPrice: number
  }) => { ok: true } | { ok: false; message: string }
  marketCloseFifo: (params: {
    side: Side
    qty: number
  }) => { ok: true; realizedPnl: number } | { ok: false; message: string }
  closeOpenLot: (
    lotId: string,
  ) =>
    | { ok: true; realizedPnl: number; side: Side; qty: number }
    | { ok: false; message: string }
  closeAllPositions: () =>
    | { ok: true; realizedPnl: number; closedCount: number }
    | { ok: false; message: string }
  placeTakeProfit: (params: {
    side: Side
    qty: number
    limitPrice: number
  }) => { ok: true } | { ok: false; message: string }
  placeStopLoss: (params: {
    side: Side
    qty: number
    stopPrice: number
  }) => { ok: true } | { ok: false; message: string }
  cancelPendingOrder: (orderId: string) => { ok: true } | { ok: false; message: string }
  availableQty: (side: Side) => number
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
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

  function availableQty(side: Side): number {
    return side === 'long' ? nets.long.qty : nets.short.qty
  }

  function openMarketOrder(params: {
    side: Side
    qty: number
  }): { ok: true } | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: sessionLocked
          ? 'Cannot trade without a mark candle.'
          : 'Play once to lock the session before trading.',
      }
    }
    const opened = openMarket({
      lots,
      side: params.side,
      qty: params.qty,
      markPrice: mark.markPrice,
      markTime: mark.markTime,
      balance,
    })
    if (!opened.ok) {
      return opened
    }
    setLots(opened.lots)
    syncTradingRef({ lots: opened.lots })
    return { ok: true }
  }

  function placeOpenLimit(params: {
    side: Side
    qty: number
    limitPrice: number
  }): { ok: true } | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: sessionLocked
          ? 'Cannot trade without a mark candle.'
          : 'Play once to lock the session before trading.',
      }
    }
    if (!(params.limitPrice > 0)) {
      return { ok: false, message: 'Limit price must be positive.' }
    }
    const order: Order = {
      id: nextTradingId('ord'),
      side: params.side,
      intent: 'open',
      type: 'limit',
      qty: params.qty,
      limitPrice: params.limitPrice,
      createdAt: mark.markTime,
    }
    const nextOrders = placeLimitOrder(pendingOrders, order)
    setPendingOrders(nextOrders)
    syncTradingRef({ pendingOrders: nextOrders })
    return { ok: true }
  }

  function marketCloseFifo(params: {
    side: Side
    qty: number
  }): { ok: true; realizedPnl: number } | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: 'Cannot close — session locked with a mark candle required.',
      }
    }
    if (!(params.qty > 0)) {
      return { ok: false, message: 'Close qty must be positive.' }
    }
    const closed = closeQtyFifo(
      lots,
      params.side,
      params.qty,
      mark.markPrice,
      mark.markTime,
    )
    if (!closed.ok) {
      return closed
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
    return { ok: true, realizedPnl: closed.realizedPnl }
  }

  function closeOpenLot(
    lotId: string,
  ):
    | { ok: true; realizedPnl: number; side: Side; qty: number }
    | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: 'Cannot close — session locked with a mark candle required.',
      }
    }
    const closed = closeLotById({
      lots,
      lotId,
      exitPrice: mark.markPrice,
      exitTime: mark.markTime,
    })
    if (!closed.ok) {
      return closed
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
    return {
      ok: true,
      realizedPnl: closed.realizedPnl,
      side: closed.closedTrade.side,
      qty: closed.closedTrade.qty,
    }
  }

  function closeAllPositions():
    | { ok: true; realizedPnl: number; closedCount: number }
    | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: 'Cannot close — session locked with a mark candle required.',
      }
    }
    if (lots.length === 0) {
      return { ok: false, message: 'Already flat — nothing to close.' }
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
    return {
      ok: true,
      realizedPnl: flattened.realizedPnl,
      closedCount: flattened.closedTrades.length,
    }
  }

  function placeTakeProfit(params: {
    side: Side
    qty: number
    limitPrice: number
  }): { ok: true } | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: 'Cannot place take profit — lock session and wait for mark.',
      }
    }
    if (!(params.limitPrice > 0) || !(params.qty > 0)) {
      return { ok: false, message: 'Take profit price and qty must be positive.' }
    }
    const available = availableQty(params.side)
    if (params.qty > available + 1e-12) {
      return {
        ok: false,
        message: `TP qty exceeds ${params.side} net.`,
      }
    }
    const order: Order = {
      id: nextTradingId('ord'),
      side: params.side,
      intent: 'close',
      type: 'limit',
      qty: params.qty,
      limitPrice: params.limitPrice,
      createdAt: mark.markTime,
    }
    const nextOrders = placeLimitOrder(pendingOrders, order)
    setPendingOrders(nextOrders)
    syncTradingRef({ pendingOrders: nextOrders })
    return { ok: true }
  }

  function placeStopLoss(params: {
    side: Side
    qty: number
    stopPrice: number
  }): { ok: true } | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: 'Cannot place stop loss — lock session and wait for mark.',
      }
    }
    if (!(params.stopPrice > 0) || !(params.qty > 0)) {
      return { ok: false, message: 'Stop loss price and qty must be positive.' }
    }
    const available = availableQty(params.side)
    if (params.qty > available + 1e-12) {
      return {
        ok: false,
        message: `SL qty exceeds ${params.side} net.`,
      }
    }
    const order: Order = {
      id: nextTradingId('ord'),
      side: params.side,
      intent: 'close',
      type: 'stop',
      qty: params.qty,
      limitPrice: params.stopPrice,
      createdAt: mark.markTime,
    }
    const nextOrders = placeStopOrder(pendingOrders, order)
    setPendingOrders(nextOrders)
    syncTradingRef({ pendingOrders: nextOrders })
    return { ok: true }
  }

  function cancelPendingOrder(
    orderId: string,
  ): { ok: true } | { ok: false; message: string } {
    const result = cancelOrder(pendingOrders, orderId)
    if (!result.cancelled) {
      return { ok: false, message: `Order ${orderId} not found.` }
    }
    setPendingOrders(result.orders)
    syncTradingRef({ pendingOrders: result.orders })
    return { ok: true }
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

  const value: SessionContextValue = {
    symbol,
    setSymbol,
    interval,
    setInterval,
    candles,
    sessionStartDate,
    playhead,
    playing,
    speed,
    sessionLocked,
    error,
    tradeMessage,
    setTradeMessage,
    loading,
    startingBalance,
    setStartingBalance,
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
    dateMin,
    dateMax,
    handleLoad,
    handleSessionStartDateChange,
    handlePlay,
    handlePause,
    setSpeed,
    openMarketOrder,
    placeOpenLimit,
    marketCloseFifo,
    closeOpenLot,
    closeAllPositions,
    placeTakeProfit,
    placeStopLoss,
    cancelPendingOrder,
    availableQty,
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}
