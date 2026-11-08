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
import TradingChart from './TradingChart'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
const SPEEDS: PlaybackSpeed[] = [1, 2, 5]

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
  const [loading, setLoading] = useState(false)
  const loadAbortRef = useRef<AbortController | null>(null)
  const playheadRef = useRef(playhead)

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

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    playheadRef.current = playhead
  }, [playhead])

  // Wall-clock playback tick; delay retargets when speed changes while playing.
  useEffect(() => {
    if (!playing) {
      return
    }

    const length = candles.length
    const timerId = window.setInterval(() => {
      const result = advancePlayhead(playheadRef.current, length)
      setPlayhead(result.playhead)
      if (result.kind === 'atEnd') {
        setPlaying(false)
      }
    }, delayForSpeed(speed))

    return () => {
      window.clearInterval(timerId)
    }
  }, [playing, speed, candles.length])

  function resetSessionFromCandles(data: MarketData[], startDate: string) {
    const startIndex =
      data.length === 0 ? 0 : resolveSessionStartIndex(data, startDate)
    setCandles(data)
    setSessionStartDate(startDate)
    setPlayhead(initialPlayhead(startIndex, data.length))
    setPlaying(false)
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
      // Keep previous candles / playback state on failure (non-destructive).
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
    return `Loaded ${candles.length} candles (${symbolLabel} ${intervalLabel}). Showing ${visibleCount} from session start — ${playLabel}, ${lockLabel}.`
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

      {error ? (
        <p className="status status-error" role="alert">
          {error}
        </p>
      ) : null}

      <p className="status status-info">{statusText}</p>

      <TradingChart candles={visibleCandles} />
    </div>
  )
}
