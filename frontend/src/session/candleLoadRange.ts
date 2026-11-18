const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
}

/** Align timestamp down to the interval boundary (UTC). */
export function alignDownToInterval(isoOrDate: Date, interval: string): Date {
  const ms = INTERVAL_MS[interval] ?? INTERVAL_MS['1h']!
  const time = isoOrDate.getTime()
  return new Date(Math.floor(time / ms) * ms)
}

export function defaultCandleRange(params: {
  lastDays?: number
  interval?: string
  now?: Date
}): { startTime: string; endTime: string } {
  const lastDays = params.lastDays ?? 7
  const interval = params.interval ?? '1h'
  const now = params.now ?? new Date()
  const end = alignDownToInterval(now, interval)
  const start = new Date(end.getTime() - lastDays * 24 * 60 * 60_000)
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  }
}

export function formatCandleLoadStatus(params: {
  source: string
  incomplete: boolean
  message?: string | null
  candleCount: number
}): string {
  const sourceLabel =
    params.source === 'local'
      ? 'local pack'
      : params.source === 'partial'
        ? 'partial download'
        : 'exchange'
  const base = `Loaded ${params.candleCount} candles from ${sourceLabel}.`
  if (params.incomplete) {
    const detail = params.message?.trim()
    return detail ? `${base} Warning: ${detail}` : `${base} Warning: series is incomplete.`
  }
  if (params.message?.trim()) {
    return `${base} ${params.message.trim()}`
  }
  return base
}
