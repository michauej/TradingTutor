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
    throw new ApiError(detail, response.status)
  }

  return (await response.json()) as MarketData[]
}
