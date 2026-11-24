import {
  createContext,
  useEffect,
  useMemo,
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
import {
  ApiError,
  createSession,
  fetchCandles,
  getSession,
  type MarketData,
  type TradingSessionDto,
} from '../services/api'
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
  type OrderIntent,
  type OrderType,
  type Side,
} from '../trading'
import {
  candleRangeFromDates,
  defaultRangeDates,
  formatCandleLoadStatus,
} from './candleLoadRange'
import {
  classifyCoverageGap,
  formatIntervalSwitchBlock,
  playheadForTimestamp,
  playheadTimestamp,
  seriesCoversTimestamp,
} from './intervalSwitch'

const DEFAULT_STARTING_BALANCE = 10_000
const DEFAULT_RANGE_DATES = defaultRangeDates({ lastDays: 90 })
const DEFAULT_EXCHANGE = 'ByBit'

type LoadRange = { startTime: string; endTime: string }

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `sess-${Date.now().toString(36)}`
}

function asSide(value: string): Side | null {
  return value === 'long' || value === 'short' ? value : null
}

function asOrderIntent(value: string): OrderIntent | null {
  return value === 'open' || value === 'close' ? value : null
}

function asOrderType(value: string): OrderType | null {
  return value === 'market' || value === 'limit' || value === 'stop'
    ? value
    : null
}

function mapImportedLots(raw: TradingSessionDto['lots']): Lot[] {
  const lots: Lot[] = []
  for (const item of raw) {
    const side = asSide(item.side)
    if (!side) continue
    lots.push({
      id: item.id,
      side,
      qty: item.qty,
      entryPrice: item.entryPrice,
      entryTime: item.entryTime,
    })
  }
  return lots
}

function mapImportedOrders(raw: TradingSessionDto['pendingOrders']): Order[] {
  const orders: Order[] = []
  for (const item of raw) {
    const side = asSide(item.side)
    const intent = asOrderIntent(item.intent)
    const type = asOrderType(item.type)
    if (!side || !intent || !type) continue
    orders.push({
      id: item.id,
      side,
      intent,
      type,
      qty: item.qty,
      limitPrice: item.limitPrice ?? undefined,
      createdAt: item.createdAt,
    })
  }
  return orders
}

function mapImportedClosedTrades(
  raw: TradingSessionDto['closedTrades'],
): ClosedTrade[] {
  const trades: ClosedTrade[] = []
  for (const item of raw) {
    const side = asSide(item.side)
    if (!side) continue
    trades.push({
      id: item.id,
      side,
      qty: item.qty,
      entryPrice: item.entryPrice,
      entryTime: item.entryTime,
      exitPrice: item.exitPrice,
      exitTime: item.exitTime,
      realizedPnl: item.realizedPnl,
    })
  }
  return trades
}

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
  /** Pre-load interval pick, or lazy TF switch once candles exist (allowed during play). */
  changeInterval: (value: string) => void
  candles: MarketData[]
  sessionStartDate: string
  playhead: number
  playing: boolean
  speed: PlaybackSpeed
  sessionLocked: boolean
  /** True when a saved session was loaded for Diary review (trading disabled). */
  isReviewMode: boolean
  activeSessionId: string | null
  error: string | null
  loadWarning: string | null
  tradeMessage: string | null
  setTradeMessage: (value: string | null) => void
  saveMessage: string | null
  loading: boolean
  /** Candle load window — From date (`YYYY-MM-DD`). */
  rangeStartDate: string
  setRangeStartDate: (value: string) => void
  /** Candle load window — To date (`YYYY-MM-DD`). */
  rangeEndDate: string
  setRangeEndDate: (value: string) => void
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
  handleRefresh: () => Promise<void>
  handleSessionStartDateChange: (nextDate: string) => void
  handlePlay: () => void
  handlePause: () => void
  setSpeed: (speed: PlaybackSpeed) => void
  /** Unlock setup on the entry screen (clears review + active save id). */
  beginSessionSetup: () => void
  /** Lock a configured sim and enter live trading (Play still starts playback). */
  startSession: () => { ok: true } | { ok: false; message: string }
  /** Persist full snapshot; reuses activeSessionId for overwrite. */
  saveSession: () => Promise<
    { ok: true; id: string } | { ok: false; message: string }
  >
  /** Load snapshot + candle refs into read-only review state for Diary. */
  importSessionForReview: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>
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
  const [isReviewMode, setIsReviewMode] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadWarning, setLoadWarning] = useState<string | null>(null)
  const [tradeMessage, setTradeMessage] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [rangeStartDate, setRangeStartDate] = useState(
    DEFAULT_RANGE_DATES.startDate,
  )
  const [rangeEndDate, setRangeEndDate] = useState(DEFAULT_RANGE_DATES.endDate)
  const [loadRange, setLoadRange] = useState<LoadRange | null>(null)
  const [seriesCache, setSeriesCache] = useState<Record<string, MarketData[]>>(
    {},
  )

  const [startingBalance, setStartingBalance] = useState(DEFAULT_STARTING_BALANCE)
  const [lots, setLots] = useState<Lot[]>([])
  const [pendingOrders, setPendingOrders] = useState<Order[]>([])
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([])
  const [realizedPnl, setRealizedPnl] = useState(0)

  const loadAbortRef = useRef<AbortController | null>(null)
  const playheadRef = useRef(playhead)
  const candlesRef = useRef(candles)
  const intervalSwitchAbortRef = useRef<AbortController | null>(null)
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
  const visibleCandles = useMemo(
    () => candles.slice(sessionStartIndex, playhead),
    [candles, sessionStartIndex, playhead],
  )
  const atEnd = isAtEnd(playhead, candles.length)
  const hasCandles = candles.length > 0
  // Fills use the active chart TF (trade on a lower TF for finer price/time).
  // Markers/spans snap those times onto whatever TF is displayed.
  const mark = markFromCandles(visibleCandles)
  const balance = accountBalance({ startingBalance, realizedPnl })
  const nets = netSides(lots)
  const canTrade = sessionLocked && !isReviewMode && mark != null

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort()
      intervalSwitchAbortRef.current?.abort()
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
    if (!hasCandles || atEnd || playing || isReviewMode) {
      return
    }
    setSessionLocked(true)
    setPlaying(true)
  }

  function handlePause() {
    setPlaying(false)
  }

  function beginSessionSetup() {
    loadAbortRef.current?.abort()
    intervalSwitchAbortRef.current?.abort()
    setIsReviewMode(false)
    setSessionLocked(false)
    setActiveSessionId(null)
    setPlaying(false)
    setSaveMessage(null)
    setTradeMessage(null)
    setError(null)
    setLoadWarning(null)
    resetTrading()
  }

  function startSession(): { ok: true } | { ok: false; message: string } {
    if (!hasCandles) {
      return { ok: false, message: 'Load candles before starting a session.' }
    }
    setIsReviewMode(false)
    setActiveSessionId(null)
    setSaveMessage(null)
    setSessionLocked(true)
    setPlaying(false)
    return { ok: true }
  }

  function buildSnapshot(id: string): TradingSessionDto {
    return {
      id,
      symbol: symbol.trim().toUpperCase(),
      exchange: DEFAULT_EXCHANGE,
      interval,
      rangeStart: loadRange?.startTime ?? null,
      rangeEnd: loadRange?.endTime ?? null,
      sessionStartDate,
      playhead,
      sessionLocked: true,
      startingBalance,
      realizedPnl,
      lots,
      pendingOrders,
      closedTrades,
    }
  }

  async function saveSession(): Promise<
    { ok: true; id: string } | { ok: false; message: string }
  > {
    if (!sessionLocked || isReviewMode) {
      return {
        ok: false,
        message: 'Save is only available during a live locked session.',
      }
    }
    if (!loadRange) {
      return {
        ok: false,
        message: 'Cannot save without a candle load range reference.',
      }
    }

    const id = activeSessionId ?? newSessionId()
    setLoading(true)
    setSaveMessage(null)
    try {
      const result = await createSession(buildSnapshot(id))
      setActiveSessionId(result.id)
      setSaveMessage(`Session saved (${result.id.slice(0, 8)}…).`)
      return { ok: true, id: result.id }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to save session'
      setSaveMessage(message)
      return { ok: false, message }
    } finally {
      setLoading(false)
    }
  }

  async function importSessionForReview(
    id: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    setLoading(true)
    setError(null)
    setLoadWarning(null)
    setSaveMessage(null)
    setPlaying(false)

    try {
      const snapshot = await getSession(id)
      if (!snapshot.rangeStart || !snapshot.rangeEnd) {
        return {
          ok: false,
          message: 'Saved session is missing candle range references.',
        }
      }

      const result = await fetchCandles({
        symbol: snapshot.symbol.trim().toUpperCase(),
        interval: snapshot.interval,
        startTime: snapshot.rangeStart,
        endTime: snapshot.rangeEnd,
        refresh: false,
      })

      if (result.candles.length === 0) {
        return {
          ok: false,
          message:
            'No candles available for the saved session refs. Load or refresh that pack first.',
        }
      }

      const nextLots = mapImportedLots(snapshot.lots ?? [])
      const nextOrders = mapImportedOrders(snapshot.pendingOrders ?? [])
      const nextTrades = mapImportedClosedTrades(snapshot.closedTrades ?? [])
      const nextPnl = snapshot.realizedPnl
      const nextBalance = snapshot.startingBalance
      const startDate =
        snapshot.sessionStartDate ||
        toDateInputValue(result.candles[0]!.timestamp)
      const startIndex = resolveSessionStartIndex(result.candles, startDate)
      const maxPlayhead = result.candles.length
      const nextPlayhead = Math.min(
        Math.max(snapshot.playhead, startIndex),
        maxPlayhead,
      )

      setSymbol(snapshot.symbol.trim().toUpperCase())
      setInterval(snapshot.interval)
      setCandles(result.candles)
      setSessionStartDate(startDate)
      setPlayhead(nextPlayhead)
      setStartingBalance(nextBalance)
      setLots(nextLots)
      setPendingOrders(nextOrders)
      setClosedTrades(nextTrades)
      setRealizedPnl(nextPnl)
      setLoadRange({
        startTime: snapshot.rangeStart,
        endTime: snapshot.rangeEnd,
      })
      setSeriesCache({ [snapshot.interval]: result.candles })
      setActiveSessionId(snapshot.id)
      setIsReviewMode(true)
      setSessionLocked(true)
      syncTradingRef({
        lots: nextLots,
        pendingOrders: nextOrders,
        closedTrades: nextTrades,
        realizedPnl: nextPnl,
        startingBalance: nextBalance,
      })
      setLoadWarning(
        formatCandleLoadStatus({
          source: result.source,
          incomplete: result.incomplete,
          message: result.message,
          candleCount: result.candles.length,
        }),
      )
      return { ok: true }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load session'
      setError(message)
      return { ok: false, message }
    } finally {
      setLoading(false)
    }
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

  function applyIntervalSeries(
    nextInterval: string,
    nextCandles: MarketData[],
    currentTime: string,
  ): boolean {
    if (!seriesCoversTimestamp(nextCandles, currentTime)) {
      const reason = classifyCoverageGap(nextCandles, currentTime)
      setLoadWarning(
        formatIntervalSwitchBlock({
          interval: nextInterval,
          currentTime,
          availableFrom: nextCandles[0]?.timestamp,
          availableTo: nextCandles[nextCandles.length - 1]?.timestamp,
          reason,
        }),
      )
      return false
    }

    const nextPlayhead = playheadForTimestamp(nextCandles, currentTime)
    setInterval(nextInterval)
    setCandles(nextCandles)
    setPlayhead(nextPlayhead)
    setLoadWarning(
      `Switched to ${nextInterval} at ${currentTime} (wall time preserved). ` +
        'Lower timeframes may not reach as far back as higher ones.',
    )
    return true
  }

  async function switchChartInterval(nextInterval: string) {
    if (nextInterval === interval) {
      return
    }

    if (candles.length === 0 || loadRange == null) {
      setInterval(nextInterval)
      return
    }

    const currentTime = playheadTimestamp(candles, playhead)
    if (currentTime == null) {
      setInterval(nextInterval)
      return
    }

    const cached = seriesCache[nextInterval]
    if (cached) {
      applyIntervalSeries(nextInterval, cached, currentTime)
      return
    }

    intervalSwitchAbortRef.current?.abort()
    const controller = new AbortController()
    intervalSwitchAbortRef.current = controller

    const wasPlaying = playing
    setPlaying(false)
    setLoading(true)
    setError(null)

    try {
      const result = await fetchCandles({
        symbol: symbol.trim().toUpperCase(),
        interval: nextInterval,
        startTime: loadRange.startTime,
        endTime: loadRange.endTime,
        refresh: false,
        signal: controller.signal,
      })

      setSeriesCache((prev) => ({ ...prev, [nextInterval]: result.candles }))

      if (result.candles.length === 0) {
        setLoadWarning(
          formatIntervalSwitchBlock({
            interval: nextInterval,
            currentTime,
            reason: 'empty',
          }),
        )
        return
      }

      const switched = applyIntervalSeries(
        nextInterval,
        result.candles,
        currentTime,
      )
      if (switched && result.incomplete) {
        setLoadWarning(
          (prev) =>
            `${prev ?? `Switched to ${nextInterval}.`} Warning: ${result.message ?? 'series incomplete.'}`,
        )
      }
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
      setLoadWarning(
        formatIntervalSwitchBlock({
          interval: nextInterval,
          currentTime,
          reason: 'load-failed',
          detail: message,
        }),
      )
    } finally {
      if (intervalSwitchAbortRef.current === controller) {
        setLoading(false)
      }
      if (wasPlaying) {
        // Leave paused after switch so the learner can verify the new TF.
        setPlaying(false)
      }
    }
  }

  function changeInterval(nextInterval: string) {
    if (candles.length > 0 && loadRange != null) {
      void switchChartInterval(nextInterval)
      return
    }
    setInterval(nextInterval)
  }

  async function loadCandles(refresh: boolean) {
    if (sessionLocked && !isReviewMode) {
      return
    }
    // Fresh candle load from entry always leaves review / prior lock behind.
    if (isReviewMode || sessionLocked) {
      setIsReviewMode(false)
      setSessionLocked(false)
      setActiveSessionId(null)
    }

    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    setLoading(true)
    setError(null)
    setLoadWarning(null)

    const range = candleRangeFromDates({
      startDate: rangeStartDate,
      endDate: rangeEndDate,
      interval,
    })
    if (!range.ok) {
      setError(range.message)
      setLoading(false)
      return
    }

    try {
      const result = await fetchCandles({
        symbol: symbol.trim().toUpperCase(),
        interval,
        startTime: range.startTime,
        endTime: range.endTime,
        refresh,
        signal: controller.signal,
      })

      if (result.candles.length === 0) {
        setError('No candles returned for the selected range.')
        return
      }

      const defaultStart = toDateInputValue(result.candles[0]!.timestamp)
      resetSessionFromCandles(result.candles, defaultStart)
      setLoadRange({
        startTime: range.startTime,
        endTime: range.endTime,
      })
      setSeriesCache({ [interval]: result.candles })
      setLoadWarning(
        formatCandleLoadStatus({
          source: result.source,
          incomplete: result.incomplete,
          message: result.message,
          candleCount: result.candles.length,
        }),
      )
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
      // Hard failure: keep any previously loaded good series.
      setError(message)
    } finally {
      if (loadAbortRef.current === controller) {
        setLoading(false)
      }
    }
  }

  async function handleLoad(event: FormEvent) {
    event.preventDefault()
    await loadCandles(false)
  }

  async function handleRefresh() {
    await loadCandles(true)
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
    changeInterval,
    candles,
    sessionStartDate,
    playhead,
    playing,
    speed,
    sessionLocked,
    isReviewMode,
    activeSessionId,
    error,
    loadWarning,
    tradeMessage,
    setTradeMessage,
    saveMessage,
    loading,
    rangeStartDate,
    setRangeStartDate,
    rangeEndDate,
    setRangeEndDate,
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
    handleRefresh,
    handleSessionStartDateChange,
    handlePlay,
    handlePause,
    setSpeed,
    beginSessionSetup,
    startSession,
    saveSession,
    importSessionForReview,
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
