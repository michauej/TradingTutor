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

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function fetchByBitCandles(
  params: FetchByBitCandlesParams,
): Promise<MarketData[]> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    // ByBit single-request max is 1000 (clamped server-side); no pagination yet.
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
  signal?: AbortSignal
}

export async function fetchCoachAnalyze(
  params: FetchCoachAnalyzeParams,
): Promise<CoachAnalyzeResult> {
  const response = await fetch('/api/coach/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closedTrades: params.closedTrades }),
    signal: params.signal,
  })

  if (!response.ok) {
    throw await toApiError(response)
  }

  return (await response.json()) as CoachAnalyzeResult
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
