export interface MarketData {
  symbol: string
  exchange: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  timestamp: string
  interval: string
}

export interface FetchByBitCandlesParams {
  symbol: string
  interval: string
  limit?: number
  signal?: AbortSignal
}

export interface FetchCandlesParams {
  symbol: string
  interval: string
  startTime: string
  endTime: string
  refresh?: boolean
  /** Progressive pack page start (0-based). Omit for full series (session/engine). */
  offset?: number
  /** Progressive pack page size (default server PackPageSize = 500). */
  limit?: number
  signal?: AbortSignal
}

export interface CandleLoadResponse {
  candles: MarketData[]
  source: 'local' | 'exchange' | 'partial' | string
  incomplete: boolean
  message?: string | null
  offset?: number
  totalCount?: number
  hasMore?: boolean
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Default FE pack page size — matches server `CandleStorage:PackPageSize`. */
export const PACK_PAGE_SIZE = 500

/** Prefetch when this many bars remain until the end of the loaded FE series. */
export const PACK_PREFETCH_REMAINING = 50

/** Orchestrated local-first candle load (preferred Load path). */
export async function fetchCandles(
  params: FetchCandlesParams,
): Promise<CandleLoadResponse> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    startTime: params.startTime,
    endTime: params.endTime,
    refresh: String(params.refresh ?? false),
  })
  if (params.offset != null) {
    query.set('offset', String(params.offset))
  }
  if (params.limit != null) {
    query.set('limit', String(params.limit))
  }

  const response = await fetch(`/api/data/candles?${query.toString()}`, {
    signal: params.signal,
  })

  if (!response.ok) {
    throw await toApiError(response)
  }

  return (await response.json()) as CandleLoadResponse
}

/** Debug/single-page ByBit passthrough (≤1000 bars). Prefer fetchCandles for Load. */
export async function fetchByBitCandles(
  params: FetchByBitCandlesParams,
): Promise<MarketData[]> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    limit: String(params.limit ?? 1000),
  })

  const response = await fetch(`/api/data/bybit?${query.toString()}`, {
    signal: params.signal,
  })

  if (!response.ok) {
    throw await toApiError(response)
  }

  return (await response.json()) as MarketData[]
}

export interface CoachRuleFinding {
  id: string
  severity: string
  message: string
  relatedTradeIds?: string[] | null
}

export interface CoachAnalyzeResult {
  findings: CoachRuleFinding[]
  verdict: string
  analysis: string
  tradeCount: number
}

export interface FetchCoachAnalyzeParams {
  sessionId: string
  signal?: AbortSignal
}

export async function fetchCoachAnalyze(
  params: FetchCoachAnalyzeParams,
): Promise<CoachAnalyzeResult> {
  const response = await fetch('/api/coach/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: params.sessionId }),
    signal: params.signal,
  })

  if (!response.ok) {
    throw await toApiError(response)
  }

  return (await response.json()) as CoachAnalyzeResult
}

export interface SessionLotDto {
  id: string
  side: string
  qty: number
  entryPrice: number
  entryTime: string
}

export interface SessionOrderDto {
  id: string
  side: string
  intent: string
  type: string
  qty: number
  limitPrice?: number | null
  createdAt: string
}

export interface SessionClosedTradeDto {
  id: string
  side: string
  qty: number
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  realizedPnl: number
}

/** Full durable session snapshot (GET /api/sessions/{id} and command responses). */
export interface TradingSessionDto {
  id: string
  createdAt?: string
  updatedAt?: string
  symbol: string
  exchange: string
  interval: string
  rangeStart?: string | null
  rangeEnd?: string | null
  sessionStartDate: string
  playhead: number
  sessionLocked: boolean
  /** Latest sim wall-clock tip — never moves backward on TF switch. */
  simWatermark?: string | null
  simMarkPrice?: number | null
  simMarkTime?: string | null
  startingBalance: number
  realizedPnl: number
  lots: SessionLotDto[]
  pendingOrders: SessionOrderDto[]
  closedTrades: SessionClosedTradeDto[]
  coachVerdict?: string | null
  coachAnalysis?: string | null
  coachFindings?: CoachRuleFinding[] | null
  coachAnalyzedAt?: string | null
}

export interface TradingSessionSummaryDto {
  id: string
  createdAt: string
  updatedAt: string
  symbol: string
  closedTradeCount: number
  startingBalance: number
}

/** Metadata-only Start payload (server assigns id; no lots/PnL authority). */
export interface StartSessionRequest {
  symbol: string
  exchange: string
  interval: string
  rangeStart: string
  rangeEnd: string
  sessionStartDate: string
  startingBalance: number
  playhead: number
}

export async function listSessions(signal?: AbortSignal): Promise<TradingSessionSummaryDto[]> {
  const response = await fetch('/api/sessions', { signal })
  if (!response.ok) {
    throw await toApiError(response)
  }
  return (await response.json()) as TradingSessionSummaryDto[]
}

export async function getSession(
  id: string,
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    signal,
  })
  if (!response.ok) {
    throw await toApiError(response)
  }
  return (await response.json()) as TradingSessionDto
}

/** Create a server-owned session; returns full session state. */
export async function startSession(
  request: StartSessionRequest,
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) {
    throw await toApiError(response)
  }
  return (await response.json()) as TradingSessionDto
}

export async function advanceSession(
  id: string,
  toPlayhead: number,
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  return postSessionCommand(id, 'advance', { toPlayhead }, signal)
}

export async function lockSession(
  id: string,
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(id)}/lock`,
    { method: 'POST', signal },
  )
  if (!response.ok) {
    throw await toApiError(response)
  }
  return (await response.json()) as TradingSessionDto
}

/** Remap session interval by sim watermark; keeps lots/orders; no fills. */
export async function reanchorSessionInterval(
  id: string,
  interval: string,
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  return postSessionCommand(id, 'interval', { interval }, signal)
}

export async function openSessionPosition(
  id: string,
  body: {
    side: string
    qty?: number
    percent?: number
  },
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  return postSessionCommand(id, 'open', body, signal)
}

export async function closeSessionPosition(
  id: string,
  body: {
    mode: 'fifo' | 'lotId' | 'qty' | 'all'
    side?: string
    lotId?: string
    qty?: number
  },
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  return postSessionCommand(id, 'close', body, signal)
}

export async function placeSessionOrder(
  id: string,
  body: {
    side: string
    intent: string
    type: string
    qty: number
    limitPrice: number
  },
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  return postSessionCommand(id, 'orders', body, signal)
}

export async function cancelSessionOrder(
  id: string,
  orderId: string,
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/cancel`,
    { method: 'POST', signal },
  )
  if (!response.ok) {
    throw await toApiError(response)
  }
  return (await response.json()) as TradingSessionDto
}

async function postSessionCommand(
  id: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<TradingSessionDto> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(id)}/${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  )
  if (!response.ok) {
    throw await toApiError(response)
  }
  return (await response.json()) as TradingSessionDto
}

async function toApiError(response: Response): Promise<ApiError> {
  let detail = `Request failed (${response.status})`
  try {
    const body = (await response.json()) as {
      detail?: string
      title?: string
    }
    detail = body.detail ?? body.title ?? detail
  } catch {
    // keep default message when body is not JSON
  }
  return new ApiError(detail, response.status)
}
