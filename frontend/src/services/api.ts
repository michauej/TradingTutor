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
  signal?: AbortSignal
}

export interface CandleLoadResponse {
  candles: MarketData[]
  source: 'local' | 'exchange' | 'partial' | string
  incomplete: boolean
  message?: string | null
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

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
  alternativeSummary?: string | null
  betterZoneLow?: number | null
  betterZoneHigh?: number | null
  betterZoneStart?: string | null
  betterZoneEnd?: string | null
  biasLabel?: string | null
}

export interface CoachAnalyzeResult {
  findings: CoachRuleFinding[]
  verdict: string
  analysis: string
  tradeCount: number
  rulePackId?: string
  candlePolicyNote?: string | null
}

export type CoachRulePackId = 'hygiene' | 'ict'

export interface FetchCoachAnalyzeParams {
  closedTrades: Array<{
    id: string
    side: 'long' | 'short'
    qty: number
    entryPrice: number
    entryTime: string
    exitPrice: number
    exitTime: string
    realizedPnl: number
  }>
  rulePackId?: CoachRulePackId
  candles?: Array<{
    timestamp: string
    open: number
    high: number
    low: number
    close: number
  }>
  signal?: AbortSignal
}

export async function fetchCoachAnalyze(
  params: FetchCoachAnalyzeParams,
): Promise<CoachAnalyzeResult> {
  const body: Record<string, unknown> = {
    closedTrades: params.closedTrades,
  }
  if (params.rulePackId) {
    body.rulePackId = params.rulePackId
  }
  if (params.candles) {
    body.candles = params.candles
  }

  const response = await fetch('/api/coach/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

/** Full durable session snapshot (POST/GET /api/sessions). */
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
  startingBalance: number
  realizedPnl: number
  lots: SessionLotDto[]
  pendingOrders: SessionOrderDto[]
  closedTrades: SessionClosedTradeDto[]
}

export interface TradingSessionSummaryDto {
  id: string
  createdAt: string
  updatedAt: string
  symbol: string
  closedTradeCount: number
  startingBalance: number
}

export interface CreateSessionResult {
  id: string
  createdAt: string
  updatedAt: string
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

export async function createSession(
  session: TradingSessionDto,
  signal?: AbortSignal,
): Promise<CreateSessionResult> {
  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
    signal,
  })
  if (!response.ok) {
    throw await toApiError(response)
  }
  return (await response.json()) as CreateSessionResult
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
