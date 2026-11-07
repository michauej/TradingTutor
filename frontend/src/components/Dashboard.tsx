import { useState, type FormEvent } from 'react'
import { ApiError, fetchByBitCandles, type MarketData } from '../services/api'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const

export default function Dashboard() {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState<string>('1h')
  const [candles, setCandles] = useState<MarketData[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLoad(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const data = await fetchByBitCandles({
        symbol: symbol.trim().toUpperCase(),
        interval,
      })
      setCandles(data)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load candles'
      setError(message)
      // Keep previous candles on failure (non-destructive).
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>TradingTutor</h1>
        <p>Load historical ByBit spot candles before a sim session.</p>
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
          />
        </label>

        <label>
          Interval
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            {INTERVALS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </form>

      {error ? (
        <p className="status status-error" role="alert">
          {error}
        </p>
      ) : null}

      <p className="status status-info">
        {candles.length === 0
          ? 'No candles loaded yet.'
          : `Loaded ${candles.length} candles (${candles[0]?.symbol} ${candles[0]?.interval}).`}
      </p>

      {candles.length > 0 ? (
        <div className="candle-preview">
          <h2>Series preview</h2>
          <p>
            First: {formatCandle(candles[0])} · Last:{' '}
            {formatCandle(candles[candles.length - 1])}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function formatCandle(candle: MarketData): string {
  return `${candle.timestamp} O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`
}
