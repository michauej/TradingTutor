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
  advanceSession,
  cancelSessionOrder,
  closeSessionPosition,
  fetchCandles,
  getSession,
  lockSession,
  openSessionPosition,
  placeSessionOrder,
  PACK_PREFETCH_REMAINING,
  reanchorSessionInterval,
  startSession as startSessionApi,
  type CoachRuleFinding,
  type MarketData,
  type TradingSessionDto,
} from '../services/api'
import {
  accountBalance,
  markFromCandles,
  netSides,
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
  extendPackEndTime,
  loadFirstPack,
  loadNextPack,
  loadPackAroundWatermark,
  packMatchesTipWindow,
  tipWindowPadMs,
  type PackSeriesState,
} from './candlePackLoader'
import { parseUtcMillis } from '../diary'
import {
  CHART_INTERVALS,
  classifyCoverageGap,
  formatIntervalSwitchBlock,
  isHigherTimeframe,
  playheadForWatermark,
  playheadTimestamp,
  seriesCoversTimestamp,
  seriesCoversWatermark,
} from './intervalSwitch'

const DEFAULT_STARTING_BALANCE = 10_000
const DEFAULT_RANGE_DATES = defaultRangeDates({ lastDays: 90 })
const DEFAULT_EXCHANGE = 'ByBit'

type LoadRange = { startTime: string; endTime: string }

function commandErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return fallback
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
  /** Intervals that returned candles for the current load range. */
  playableIntervals: string[]
  /** Latest sim wall-clock tip (ISO); never moves backward on TF switch. */
  simWatermark: string | null
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
  coachVerdict: string | null
  coachAnalysis: string | null
  coachFindings: CoachRuleFinding[]
  coachAnalyzedAt: string | null
  /** Keep last analyze result in session memory after API success. */
  rememberCoachResult: (result: {
    verdict: string
    analysis: string
    findings: CoachRuleFinding[]
  }) => void
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
  /**
   * Create a server-owned session (locked) and enter the sim.
   * Play still starts playback only.
   */
  startSession: () => Promise<{ ok: true } | { ok: false; message: string }>
  /** Session is already persisted after every command — confirms active id. */
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
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  placeOpenLimit: (params: {
    side: Side
    qty: number
    limitPrice: number
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  marketCloseFifo: (params: {
    side: Side
    qty: number
  }) => Promise<
    { ok: true; realizedPnl: number } | { ok: false; message: string }
  >
  closeOpenLot: (
    lotId: string,
  ) => Promise<
    | { ok: true; realizedPnl: number; side: Side; qty: number }
    | { ok: false; message: string }
  >
  closeAllPositions: () => Promise<
    | { ok: true; realizedPnl: number; closedCount: number }
    | { ok: false; message: string }
  >
  placeTakeProfit: (params: {
    side: Side
    qty: number
    limitPrice: number
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  placeStopLoss: (params: {
    side: Side
    qty: number
    stopPrice: number
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  cancelPendingOrder: (
    orderId: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>
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
  const [seriesCache, setSeriesCache] = useState<
    Record<string, PackSeriesState>
  >({})
  const packPrefetchInFlightRef = useRef(false)
  const intervalRef = useRef(interval)
  const [playableIntervals, setPlayableIntervals] = useState<string[]>([])
  const [simWatermark, setSimWatermark] = useState<string | null>(null)
  const [simMark, setSimMark] = useState<{
    markPrice: number
    markTime: string
  } | null>(null)

  const [startingBalance, setStartingBalance] = useState(DEFAULT_STARTING_BALANCE)
  const [lots, setLots] = useState<Lot[]>([])
  const [pendingOrders, setPendingOrders] = useState<Order[]>([])
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([])
  const [realizedPnl, setRealizedPnl] = useState(0)
  const [coachVerdict, setCoachVerdict] = useState<string | null>(null)
  const [coachAnalysis, setCoachAnalysis] = useState<string | null>(null)
  const [coachFindings, setCoachFindings] = useState<CoachRuleFinding[]>([])
  const [coachAnalyzedAt, setCoachAnalyzedAt] = useState<string | null>(null)

  const loadAbortRef = useRef<AbortController | null>(null)
  const playheadRef = useRef(playhead)
  const candlesRef = useRef(candles)
  const intervalSwitchAbortRef = useRef<AbortController | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const serverPlayheadRef = useRef(0)
  const pendingToPlayheadRef = useRef<number | null>(null)
  const advanceInFlightRef = useRef(false)
  const tradeQueueRef = useRef<
    Array<{
      run: () => Promise<
        { ok: true; session: TradingSessionDto } | { ok: false; message: string }
      >
      resolve: (
        value:
          | { ok: true; session: TradingSessionDto }
          | { ok: false; message: string },
      ) => void
    }>
  >([])
  const pumpRunningRef = useRef(false)
  const isReviewModeRef = useRef(isReviewMode)
  const markRef = useRef<{ markPrice: number; markTime: string } | null>(null)

  const sessionStartIndex =
    candles.length === 0
      ? 0
      : resolveSessionStartIndex(
          candles,
          sessionStartDate || candles[0]!.timestamp,
        )
  // Fog-of-war hides only the future (after playhead). Show the full active pack
  // up to the tip so LTF switches keep history (tip-centered 1m packs, HTF context).
  const visibleCandles = useMemo(() => {
    if (playhead <= 0) {
      return []
    }
    return candles.slice(0, playhead)
  }, [candles, playhead])
  const atEnd = isAtEnd(playhead, candles.length)
  const hasCandles = candles.length > 0
  // Prefer the chart tip when optimistic playhead is ahead of the last server mark.
  const chartMark = markFromCandles(visibleCandles)
  const mark = (() => {
    if (chartMark == null) {
      return simMark
    }
    if (simMark == null) {
      return chartMark
    }
    const chartMs = parseUtcMillis(chartMark.markTime)
    const simMs = parseUtcMillis(simMark.markTime)
    if (chartMs != null && simMs != null && chartMs > simMs) {
      return chartMark
    }
    return simMark
  })()
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
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    isReviewModeRef.current = isReviewMode
  }, [isReviewMode])

  useEffect(() => {
    markRef.current = mark
  }, [mark])

  useEffect(() => {
    intervalRef.current = interval
  }, [interval])

  // Prefetch the next ~500-bar pack when play nears the end of the FE page.
  // Do not abort on playhead ticks — only one in-flight fetch at a time.
  useEffect(() => {
    if (!loadRange || isReviewMode || packPrefetchInFlightRef.current) {
      return
    }
    const remaining = candles.length - playhead
    if (remaining > PACK_PREFETCH_REMAINING) {
      return
    }
    const pack = seriesCache[interval]
    if (!pack) {
      return
    }

    let endTime = pack.endTime
    let current = pack
    if (!pack.hasMore) {
      const extended = extendPackEndTime(
        pack.endTime,
        loadRange.endTime,
        tipWindowPadMs(interval),
      )
      if (extended == null) {
        return
      }
      endTime = extended
      current = { ...pack, endTime: extended, hasMore: true }
    }

    const prefetchInterval = interval
    packPrefetchInFlightRef.current = true
    void loadNextPack({
      symbol: symbol.trim().toUpperCase(),
      interval: prefetchInterval,
      current,
      endTime,
    })
      .then((next) => {
        setSeriesCache((prev) => ({ ...prev, [prefetchInterval]: next }))
        if (intervalRef.current === prefetchInterval) {
          setCandles(next.candles)
          candlesRef.current = next.candles
        }
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setLoadWarning(
            (prev) =>
              prev ??
              commandErrorMessage(err, 'Failed to prefetch next candle pack'),
          )
        }
      })
      .finally(() => {
        packPrefetchInFlightRef.current = false
      })
  }, [
    playhead,
    candles.length,
    interval,
    loadRange,
    isReviewMode,
    seriesCache,
    symbol,
  ])

  function applyCoachFields(snapshot: TradingSessionDto) {
    setCoachVerdict(snapshot.coachVerdict ?? null)
    setCoachAnalysis(snapshot.coachAnalysis ?? null)
    setCoachFindings(snapshot.coachFindings ?? [])
    setCoachAnalyzedAt(snapshot.coachAnalyzedAt ?? null)
  }

  function rememberCoachResult(result: {
    verdict: string
    analysis: string
    findings: CoachRuleFinding[]
  }) {
    setCoachVerdict(result.verdict)
    setCoachAnalysis(result.analysis)
    setCoachFindings(result.findings)
    setCoachAnalyzedAt(new Date().toISOString())
  }

  function applySimClock(snapshot: TradingSessionDto) {
    if (snapshot.simWatermark) {
      setSimWatermark(snapshot.simWatermark)
    }
    if (
      snapshot.simMarkPrice != null &&
      snapshot.simMarkPrice > 0 &&
      snapshot.simMarkTime
    ) {
      setSimMark({
        markPrice: snapshot.simMarkPrice,
        markTime: snapshot.simMarkTime,
      })
    }
  }

  function applyServerTradingState(
    snapshot: TradingSessionDto,
    options?: { preserveOptimisticPlayhead?: boolean },
  ) {
    const nextLots = mapImportedLots(snapshot.lots ?? [])
    const nextOrders = mapImportedOrders(snapshot.pendingOrders ?? [])
    const nextTrades = mapImportedClosedTrades(snapshot.closedTrades ?? [])
    const nextPnl = snapshot.realizedPnl
    const nextBalance = snapshot.startingBalance
    const serverPlayhead = snapshot.playhead
    serverPlayheadRef.current = serverPlayhead

    const optimistic = pendingToPlayheadRef.current
    const nextPlayhead =
      options?.preserveOptimisticPlayhead &&
      optimistic != null &&
      optimistic > serverPlayhead
        ? optimistic
        : serverPlayhead

    setLots(nextLots)
    setPendingOrders(nextOrders)
    setClosedTrades(nextTrades)
    setRealizedPnl(nextPnl)
    setStartingBalance(nextBalance)
    setPlayhead(nextPlayhead)
    setSessionLocked(snapshot.sessionLocked)
    setActiveSessionId(snapshot.id)
    activeSessionIdRef.current = snapshot.id
    playheadRef.current = nextPlayhead
    if (snapshot.interval) {
      setInterval(snapshot.interval)
    }
    applySimClock(snapshot)
    applyCoachFields(snapshot)
  }

  async function pumpSessionWork() {
    if (pumpRunningRef.current) {
      return
    }
    pumpRunningRef.current = true
    try {
      while (true) {
        const sessionId = activeSessionIdRef.current
        if (!sessionId || isReviewModeRef.current) {
          break
        }

        // Catch server playhead up to the chart tip BEFORE trades/orders so
        // Buy/Close use the same mark time the learner sees (not a stale tip).
        const pendingTarget = pendingToPlayheadRef.current
        const serverHead = serverPlayheadRef.current
        const hasTradeWaiting = tradeQueueRef.current.length > 0
        if (pendingTarget != null && pendingTarget > serverHead) {
          pendingToPlayheadRef.current = null
          advanceInFlightRef.current = true
          const to = pendingTarget
          try {
            const session = await advanceSession(sessionId, to)
            applyServerTradingState(session, {
              // When a trade is waiting, snap to the flushed tip (no optimistic gap).
              preserveOptimisticPlayhead: !hasTradeWaiting,
            })
            if (isAtEnd(session.playhead, candlesRef.current.length)) {
              setPlaying(false)
            }
          } catch (err: unknown) {
            setTradeMessage(
              commandErrorMessage(err, 'Failed to advance session'),
            )
            setPlaying(false)
            pendingToPlayheadRef.current = null
            // Snap chart back to last confirmed server playhead.
            setPlayhead(serverPlayheadRef.current)
            playheadRef.current = serverPlayheadRef.current
          } finally {
            advanceInFlightRef.current = false
          }
          continue
        }

        const job = tradeQueueRef.current.shift()
        if (job) {
          try {
            const result = await job.run()
            job.resolve(result)
          } catch (err: unknown) {
            job.resolve({
              ok: false,
              message: commandErrorMessage(err, 'Session command failed'),
            })
          }
          continue
        }

        break
      }
    } finally {
      pumpRunningRef.current = false
      if (
        (pendingToPlayheadRef.current != null &&
          pendingToPlayheadRef.current > serverPlayheadRef.current) ||
        tradeQueueRef.current.length > 0
      ) {
        void pumpSessionWork()
      }
    }
  }

  function scheduleAdvanceTo(toPlayhead: number) {
    const currentPending = pendingToPlayheadRef.current
    pendingToPlayheadRef.current =
      currentPending == null
        ? toPlayhead
        : Math.max(currentPending, toPlayhead)
    // Optimistic chart reveal; server remains source of trading truth.
    setPlayhead(toPlayhead)
    playheadRef.current = toPlayhead
    void pumpSessionWork()
  }

  function runSessionCommand(
    action: (sessionId: string) => Promise<TradingSessionDto>,
  ): Promise<
    { ok: true; session: TradingSessionDto } | { ok: false; message: string }
  > {
    const sessionId = activeSessionIdRef.current
    if (!sessionId) {
      return Promise.resolve({
        ok: false,
        message: 'No active server session.',
      })
    }

    return new Promise((resolve) => {
      tradeQueueRef.current.push({
        run: async () => {
          const session = await action(sessionId)
          applyServerTradingState(session)
          return { ok: true, session }
        },
        resolve,
      })
      void pumpSessionWork()
    })
  }

  useEffect(() => {
    if (!playing) {
      return
    }

    const length = candles.length
    const timerId = window.setInterval(() => {
      if (isReviewModeRef.current) {
        return
      }
      if (!activeSessionIdRef.current) {
        setPlaying(false)
        return
      }
      const previous = playheadRef.current
      const result = advancePlayhead(previous, length)
      if (result.playhead <= previous) {
        if (result.kind === 'atEnd') {
          setPlaying(false)
        }
        return
      }
      scheduleAdvanceTo(result.playhead)
    }, delayForSpeed(speed))

    return () => {
      window.clearInterval(timerId)
    }
  }, [playing, speed, candles.length])

  function resetTrading() {
    const empty = emptyTradingState()
    setLots(empty.lots)
    setPendingOrders(empty.pendingOrders)
    setClosedTrades(empty.closedTrades)
    setRealizedPnl(empty.realizedPnl)
    setCoachVerdict(null)
    setCoachAnalysis(null)
    setCoachFindings([])
    setCoachAnalyzedAt(null)
    setTradeMessage(null)
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
    const sessionId = activeSessionIdRef.current
    if (!sessionId) {
      setTradeMessage('Start a server session before playing.')
      return
    }
    if (sessionLocked) {
      setPlaying(true)
      return
    }
    void runSessionCommand((id) => lockSession(id)).then((result) => {
      if (!result.ok) {
        setTradeMessage(result.message)
        return
      }
      setPlaying(true)
    })
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

  async function startSession(): Promise<
    { ok: true } | { ok: false; message: string }
  > {
    if (!hasCandles) {
      return { ok: false, message: 'Load candles before starting a session.' }
    }
    if (!loadRange) {
      return {
        ok: false,
        message: 'Cannot start without a candle load range reference.',
      }
    }

    setLoading(true)
    setSaveMessage(null)
    setTradeMessage(null)
    setIsReviewMode(false)
    setPlaying(false)
    try {
      const session = await startSessionApi({
        symbol: symbol.trim().toUpperCase(),
        exchange: DEFAULT_EXCHANGE,
        interval,
        rangeStart: loadRange.startTime,
        rangeEnd: loadRange.endTime,
        sessionStartDate,
        startingBalance,
        playhead,
      })
      applyServerTradingState(session)
      // Trade route requires a locked session; keep UI locked even if an older
      // API build still returns sessionLocked=false from Start.
      setSessionLocked(true)
      setSaveMessage(`Session started (${session.id.slice(0, 8)}…).`)
      return { ok: true }
    } catch (err) {
      const message = commandErrorMessage(err, 'Failed to start session')
      setSaveMessage(message)
      return { ok: false, message }
    } finally {
      setLoading(false)
    }
  }

  async function saveSession(): Promise<
    { ok: true; id: string } | { ok: false; message: string }
  > {
    if (!activeSessionId || isReviewMode) {
      return {
        ok: false,
        message: 'No live server session to confirm.',
      }
    }
    setSaveMessage(
      `Session is persisted on the server (${activeSessionId.slice(0, 8)}…).`,
    )
    return { ok: true, id: activeSessionId }
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
      applyCoachFields(snapshot)
      setLoadRange({
        startTime: snapshot.rangeStart,
        endTime: snapshot.rangeEnd,
      })
      setSeriesCache({
        [snapshot.interval]: {
          candles: result.candles,
          nextOffset: result.candles.length,
          totalCount: result.totalCount ?? result.candles.length,
          hasMore: result.hasMore ?? false,
          startTime: snapshot.rangeStart,
          endTime: snapshot.rangeEnd,
        },
      })
      setPlayableIntervals([snapshot.interval])
      applySimClock(snapshot)
      setActiveSessionId(snapshot.id)
      activeSessionIdRef.current = snapshot.id
      setIsReviewMode(true)
      setSessionLocked(true)
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

  function requireLiveTrade(): { ok: true } | { ok: false; message: string } {
    if (!canTrade || !mark) {
      return {
        ok: false,
        message: sessionLocked
          ? 'Cannot trade without a mark candle.'
          : 'Play once to lock the session before trading.',
      }
    }
    return { ok: true }
  }

  async function openMarketOrder(params: {
    side: Side
    qty: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const gate = requireLiveTrade()
    if (!gate.ok) {
      return gate
    }
    const result = await runSessionCommand((id) =>
      openSessionPosition(id, {
        side: params.side,
        qty: params.qty,
      }),
    )
    return result.ok ? { ok: true } : result
  }

  async function placeOpenLimit(params: {
    side: Side
    qty: number
    limitPrice: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const gate = requireLiveTrade()
    if (!gate.ok) {
      return gate
    }
    if (!(params.limitPrice > 0)) {
      return { ok: false, message: 'Limit price must be positive.' }
    }
    const result = await runSessionCommand((id) =>
      placeSessionOrder(id, {
        side: params.side,
        intent: 'open',
        type: 'limit',
        qty: params.qty,
        limitPrice: params.limitPrice,
      }),
    )
    return result.ok ? { ok: true } : result
  }

  async function marketCloseFifo(params: {
    side: Side
    qty: number
  }): Promise<
    { ok: true; realizedPnl: number } | { ok: false; message: string }
  > {
    const gate = requireLiveTrade()
    if (!gate.ok) {
      return gate
    }
    if (!(params.qty > 0)) {
      return { ok: false, message: 'Close qty must be positive.' }
    }
    const beforePnl = realizedPnl
    const result = await runSessionCommand((id) =>
      closeSessionPosition(id, {
        mode: 'qty',
        side: params.side,
        qty: params.qty,
      }),
    )
    if (!result.ok) {
      return result
    }
    return {
      ok: true,
      realizedPnl: result.session.realizedPnl - beforePnl,
    }
  }

  async function closeOpenLot(
    lotId: string,
  ): Promise<
    | { ok: true; realizedPnl: number; side: Side; qty: number }
    | { ok: false; message: string }
  > {
    const gate = requireLiveTrade()
    if (!gate.ok) {
      return gate
    }
    const before = lots.find((lot) => lot.id === lotId)
    const beforePnl = realizedPnl
    const result = await runSessionCommand((id) =>
      closeSessionPosition(id, { mode: 'lotId', lotId }),
    )
    if (!result.ok) {
      return result
    }
    const closed = result.session.closedTrades[result.session.closedTrades.length - 1]
    const side = asSide(closed?.side ?? before?.side ?? '')
    if (!side) {
      return { ok: false, message: 'Close succeeded but side was invalid.' }
    }
    return {
      ok: true,
      realizedPnl: result.session.realizedPnl - beforePnl,
      side,
      qty: closed?.qty ?? before?.qty ?? 0,
    }
  }

  async function closeAllPositions(): Promise<
    | { ok: true; realizedPnl: number; closedCount: number }
    | { ok: false; message: string }
  > {
    const gate = requireLiveTrade()
    if (!gate.ok) {
      return gate
    }
    if (lots.length === 0) {
      return { ok: false, message: 'Already flat — nothing to close.' }
    }
    const beforeCount = closedTrades.length
    const beforePnl = realizedPnl
    const result = await runSessionCommand((id) =>
      closeSessionPosition(id, { mode: 'all' }),
    )
    if (!result.ok) {
      return result
    }
    return {
      ok: true,
      realizedPnl: result.session.realizedPnl - beforePnl,
      closedCount: result.session.closedTrades.length - beforeCount,
    }
  }

  async function placeTakeProfit(params: {
    side: Side
    qty: number
    limitPrice: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const gate = requireLiveTrade()
    if (!gate.ok) {
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
    const result = await runSessionCommand((id) =>
      placeSessionOrder(id, {
        side: params.side,
        intent: 'close',
        type: 'limit',
        qty: params.qty,
        limitPrice: params.limitPrice,
      }),
    )
    return result.ok ? { ok: true } : result
  }

  async function placeStopLoss(params: {
    side: Side
    qty: number
    stopPrice: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const gate = requireLiveTrade()
    if (!gate.ok) {
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
    const result = await runSessionCommand((id) =>
      placeSessionOrder(id, {
        side: params.side,
        intent: 'close',
        type: 'stop',
        qty: params.qty,
        limitPrice: params.stopPrice,
      }),
    )
    return result.ok ? { ok: true } : result
  }

  async function cancelPendingOrder(
    orderId: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const result = await runSessionCommand((id) =>
      cancelSessionOrder(id, orderId),
    )
    return result.ok ? { ok: true } : result
  }

  function applyIntervalSeries(
    nextInterval: string,
    nextCandles: MarketData[],
    watermarkIso: string,
  ): boolean {
    if (!seriesCoversTimestamp(nextCandles, watermarkIso)) {
      const reason = classifyCoverageGap(nextCandles, watermarkIso)
      setLoadWarning(
        formatIntervalSwitchBlock({
          interval: nextInterval,
          currentTime: watermarkIso,
          availableFrom: nextCandles[0]?.timestamp,
          availableTo: nextCandles[nextCandles.length - 1]?.timestamp,
          reason,
        }),
      )
      return false
    }

    const nextPlayhead = playheadForWatermark(
      nextCandles,
      watermarkIso,
      nextInterval,
    )
    setInterval(nextInterval)
    setCandles(nextCandles)
    setPlayhead(nextPlayhead)
    playheadRef.current = nextPlayhead
    candlesRef.current = nextCandles
    setLoadWarning(
      `Switched to ${nextInterval} at ${watermarkIso} (sim watermark preserved). ` +
        'Higher TF pauses until Play; lower TF continues.',
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

    if (
      playableIntervals.length > 0 &&
      !playableIntervals.includes(nextInterval)
    ) {
      setLoadWarning(
        `Interval ${nextInterval} is not playable for this load range.`,
      )
      return
    }

    const watermark =
      simWatermark ?? playheadTimestamp(candles, playhead)
    if (watermark == null) {
      setInterval(nextInterval)
      return
    }

    const goingHigher = isHigherTimeframe(interval, nextInterval)
    const wasPlaying = playing
    // →HTF always pauses; →LTF keeps playing after remap when it was playing.
    setPlaying(false)

    intervalSwitchAbortRef.current?.abort()
    const controller = new AbortController()
    intervalSwitchAbortRef.current = controller
    setLoading(true)
    setError(null)

    try {
      const sessionId = activeSessionIdRef.current
      // Flush optimistic playhead so server watermark matches the chart tip
      // before remapping — otherwise TF switch can snap time backward.
      if (
        sessionId &&
        sessionLocked &&
        !isReviewMode &&
        pendingToPlayheadRef.current != null &&
        pendingToPlayheadRef.current > serverPlayheadRef.current
      ) {
        const flushTo = pendingToPlayheadRef.current
        pendingToPlayheadRef.current = null
        const flushed = await advanceSession(
          sessionId,
          flushTo,
          controller.signal,
        )
        applyServerTradingState(flushed)
      } else {
        pendingToPlayheadRef.current = null
      }

      const tipWatermark =
        simWatermark ??
        playheadTimestamp(candlesRef.current, playheadRef.current) ??
        watermark

      // Tip±pad window for the new TF — must match server ActivePack bounds.
      // Reusing an older tip window that merely *covers* the tip applies the
      // server playhead (indexed into the new window) onto the wrong series
      // (e.g. 5m jumps back ~2 days to the previous tip).
      let packState = seriesCache[nextInterval]
      if (
        !packMatchesTipWindow({
          pack: packState,
          watermarkIso: tipWatermark,
          rangeStartIso: loadRange.startTime,
          rangeEndIso: loadRange.endTime,
          interval: nextInterval,
        })
      ) {
        packState = await loadPackAroundWatermark({
          symbol: symbol.trim().toUpperCase(),
          interval: nextInterval,
          rangeStartIso: loadRange.startTime,
          rangeEndIso: loadRange.endTime,
          watermarkIso: tipWatermark,
          signal: controller.signal,
        })
        if (packState.candles.length > 0) {
          setSeriesCache((prev) => ({ ...prev, [nextInterval]: packState! }))
          setPlayableIntervals((prev) =>
            prev.includes(nextInterval) ? prev : [...prev, nextInterval],
          )
        }
      }

      const nextCandles = packState?.candles ?? []
      if (nextCandles.length === 0) {
        setLoadWarning(
          formatIntervalSwitchBlock({
            interval: nextInterval,
            currentTime: tipWatermark,
            reason: 'empty',
          }),
        )
        return
      }

      if (!seriesCoversWatermark(nextCandles, tipWatermark, nextInterval)) {
        const reason = classifyCoverageGap(nextCandles, tipWatermark)
        setLoadWarning(
          formatIntervalSwitchBlock({
            interval: nextInterval,
            currentTime: tipWatermark,
            availableFrom: nextCandles[0]?.timestamp,
            availableTo: nextCandles[nextCandles.length - 1]?.timestamp,
            reason: reason === 'empty' ? 'too-early' : reason,
          }),
        )
        return
      }

      if (sessionId && sessionLocked && !isReviewMode) {
        const session = await reanchorSessionInterval(
          sessionId,
          nextInterval,
          controller.signal,
        )
        const seriesForInterval =
          session.interval === nextInterval
            ? packState!
            : (seriesCache[session.interval] ?? packState!)
        setSeriesCache((prev) => ({
          ...prev,
          [session.interval]: seriesForInterval,
        }))
        const nextCandlesForSession = seriesForInterval.candles
        setCandles(nextCandlesForSession)
        candlesRef.current = nextCandlesForSession
        applyServerTradingState(session)
        // Remap onto the tip±pad FE series (same bounds as server ActivePack).
        const tip = session.simWatermark ?? tipWatermark
        const localPlayhead = playheadForWatermark(
          nextCandlesForSession,
          tip,
          session.interval,
        )
        // FE series is the tip±pad window — remap by watermark, not a raw
        // server index that may belong to a different cached window.
        setPlayhead(localPlayhead)
        playheadRef.current = localPlayhead
        serverPlayheadRef.current = localPlayhead
        pendingToPlayheadRef.current = null
        setPlaying(false)
        setLoadWarning(
          goingHigher
            ? `Switched to higher TF ${session.interval}. Paused until Play (tip ${tip}).`
            : `Switched to ${session.interval} at tip ${tip}. Orders kept. Paused until Play.`,
        )
        return
      }

      const switched = applyIntervalSeries(
        nextInterval,
        nextCandles,
        tipWatermark,
      )
      if (switched && !goingHigher && wasPlaying) {
        setPlaying(true)
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
            : 'Failed to switch interval'
      setLoadWarning(
        formatIntervalSwitchBlock({
          interval: nextInterval,
          currentTime: watermark,
          reason: 'load-failed',
          detail: message,
        }),
      )
    } finally {
      if (intervalSwitchAbortRef.current === controller) {
        setLoading(false)
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
    setSimWatermark(null)
    setSimMark(null)

    try {
      const selected = interval
      const cache: Record<string, PackSeriesState> = {}
      const playable: string[] = []
      const notes: string[] = []

      // Ensure full range on server; FE only takes the first pack page (~500).
      await Promise.all(
        CHART_INTERVALS.map(async (tf) => {
          const range = candleRangeFromDates({
            startDate: rangeStartDate,
            endDate: rangeEndDate,
            interval: tf,
          })
          if (!range.ok) {
            notes.push(`${tf}: ${range.message}`)
            return
          }
          try {
            const pack = await loadFirstPack({
              symbol: symbol.trim().toUpperCase(),
              interval: tf,
              startTime: range.startTime,
              endTime: range.endTime,
              refresh,
              signal: controller.signal,
            })
            if (pack.candles.length > 0) {
              cache[tf] = {
                candles: pack.candles,
                nextOffset: pack.nextOffset,
                totalCount: pack.totalCount,
                hasMore: pack.hasMore,
                startTime: pack.startTime,
                endTime: pack.endTime,
              }
              playable.push(tf)
              if (pack.incomplete) {
                notes.push(
                  `${tf}: incomplete${pack.message ? ` (${pack.message})` : ''}`,
                )
              }
            } else {
              notes.push(`${tf}: no candles`)
            }
          } catch (err) {
            if (isAbortError(err)) {
              throw err
            }
            const message =
              err instanceof ApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'load failed'
            notes.push(`${tf}: ${message}`)
          }
        }),
      )

      if (controller.signal.aborted) {
        return
      }

      const primaryPack =
        cache[selected] ??
        (playable[0] != null ? cache[playable[0]] : undefined)
      const activeInterval =
        cache[selected] != null
          ? selected
          : (playable[0] ?? selected)

      if (!primaryPack || primaryPack.candles.length === 0) {
        setError(
          notes.length > 0
            ? `No playable intervals. ${notes.join('; ')}`
            : 'No candles returned for the selected range.',
        )
        setSeriesCache({})
        setPlayableIntervals([])
        return
      }

      const primaryRange = candleRangeFromDates({
        startDate: rangeStartDate,
        endDate: rangeEndDate,
        interval: activeInterval,
      })
      if (!primaryRange.ok) {
        setError(primaryRange.message)
        return
      }

      const defaultStart = toDateInputValue(primaryPack.candles[0]!.timestamp)
      resetSessionFromCandles(primaryPack.candles, defaultStart)
      setInterval(activeInterval)
      setLoadRange({
        startTime: primaryRange.startTime,
        endTime: primaryRange.endTime,
      })
      setSeriesCache(cache)
      setPlayableIntervals(
        CHART_INTERVALS.filter((tf) => playable.includes(tf)),
      )

      const playableLabel = playable.join(', ')
      const unavailable = CHART_INTERVALS.filter((tf) => !playable.includes(tf))
      const unavailableLabel =
        unavailable.length > 0 ? ` Not available: ${unavailable.join(', ')}.` : ''
      const detail = notes.length > 0 ? ` ${notes.join('; ')}.` : ''
      setLoadWarning(
        `Playable: ${playableLabel}.${unavailableLabel}` +
          formatCandleLoadStatus({
            source: 'local',
            incomplete: notes.some((n) => n.includes('incomplete')),
            message: detail.trim() || null,
            candleCount: primaryPack.candles.length,
            totalCount: primaryPack.totalCount,
            hasMore: primaryPack.hasMore,
          }).replace(/^Loaded/, ' Active series'),
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
    playableIntervals,
    simWatermark,
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
    coachVerdict,
    coachAnalysis,
    coachFindings,
    coachAnalyzedAt,
    rememberCoachResult,
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
