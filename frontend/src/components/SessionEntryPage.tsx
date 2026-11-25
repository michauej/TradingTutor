import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CHART_INTERVALS,
  earliestFromDateForInterval,
  useSession,
} from '../session'
import {
  ApiError,
  listSessions,
  type TradingSessionSummaryDto,
} from '../services/api'

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) {
    return iso
  }
  return new Date(ms).toLocaleString()
}

export default function SessionEntryPage() {
  const navigate = useNavigate()
  const {
    symbol,
    setSymbol,
    interval,
    changeInterval,
    playableIntervals,
    sessionStartDate,
    error,
    loadWarning,
    loading,
    rangeStartDate,
    setRangeStartDate,
    rangeEndDate,
    setRangeEndDate,
    startingBalance,
    setStartingBalance,
    hasCandles,
    dateMin,
    dateMax,
    handleLoad,
    handleSessionStartDateChange,
    beginSessionSetup,
    startSession,
    importSessionForReview,
  } = useSession()

  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [sessions, setSessions] = useState<TradingSessionSummaryDto[]>([])
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  useEffect(() => {
    beginSessionSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset once on entry mount
  }, [])

  async function refreshSessionList() {
    setListLoading(true)
    setListError(null)
    try {
      const items = await listSessions()
      setSessions(items)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to list sessions'
      setListError(message)
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => {
    void refreshSessionList()
  }, [])

  async function handleStart() {
    setActionMessage(null)
    const started = await startSession()
    if (!started.ok) {
      setActionMessage(started.message)
      return
    }
    navigate('/trade')
  }

  async function handlePickSession(id: string) {
    setActionMessage(null)
    const imported = await importSessionForReview(id)
    if (!imported.ok) {
      setActionMessage(imported.message)
      return
    }
    navigate('/diary')
  }

  async function onLoadSubmit(event: FormEvent) {
    setActionMessage(null)
    await handleLoad(event)
  }

  return (
    <div className="dashboard session-entry">
      <header className="dashboard-header">
        <h1>TradingTutor</h1>
        <p>
          Configure a paper session, then start a new sim or load a saved
          session into the Trader&apos;s Diary for read-only review.
        </p>
      </header>

      <section className="session-entry-section" aria-labelledby="start-heading">
        <h2 id="start-heading">Start session</h2>
        <form className="load-form" onSubmit={onLoadSubmit}>
          <label>
            Symbol
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              disabled={loading}
            />
          </label>

          <label>
            Chart interval
            <select
              value={interval}
              onChange={(e) => changeInterval(e.target.value)}
              disabled={loading}
              aria-label="Chart interval"
            >
              {CHART_INTERVALS.map((value) => {
                const playable =
                  playableIntervals.length === 0 ||
                  playableIntervals.includes(value)
                return (
                  <option key={value} value={value} disabled={!playable}>
                    {playable ? value : `${value} (n/a)`}
                  </option>
                )
              })}
            </select>
          </label>

          <label>
            From date
            <input
              type="date"
              value={rangeStartDate}
              max={rangeEndDate || undefined}
              onChange={(e) => setRangeStartDate(e.target.value)}
              disabled={loading}
              required
              aria-label="Candle range from date"
            />
          </label>

          <label>
            To date
            <input
              type="date"
              value={rangeEndDate}
              min={rangeStartDate || undefined}
              onChange={(e) => setRangeEndDate(e.target.value)}
              disabled={loading}
              required
              aria-label="Candle range to date"
            />
          </label>

          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Load'}
          </button>

          <button
            type="button"
            onClick={() => {
              const earliest = earliestFromDateForInterval({
                endDate: rangeEndDate,
                interval,
              })
              if (earliest) {
                setRangeStartDate(earliest)
              }
            }}
            disabled={loading || !rangeEndDate}
            aria-label="Set earliest From date for interval"
          >
            Earliest From
          </button>

          <label className="load-form-row-start">
            Session start
            <input
              type="date"
              value={sessionStartDate}
              min={dateMin}
              max={dateMax}
              onChange={(e) => handleSessionStartDateChange(e.target.value)}
              disabled={!hasCandles || loading}
            />
          </label>
          <p className="load-form-hint">
            From/To set how much history to store in the server pack. The chart
            loads ~500-bar pages. On TF switch it loads a tip window (at least 2
            days or ~500 bars each side), then fetches more as play nears the
            end. Earliest From is a soft date hint only. Session start sets where
            playback begins.
          </p>

          <label>
            Starting balance
            <input
              type="number"
              min={0}
              step="any"
              value={startingBalance}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isFinite(next) && next >= 0) {
                  setStartingBalance(next)
                }
              }}
              disabled={loading}
            />
          </label>

          <button
            type="button"
            className="session-primary-action"
            onClick={handleStart}
            disabled={loading || !hasCandles}
          >
            Start session
          </button>
        </form>

        {error ? (
          <p className="status-error" role="alert">
            {error}
          </p>
        ) : null}
        {loadWarning ? <p className="status-warning">{loadWarning}</p> : null}
        {actionMessage ? (
          <p className="status-error" role="alert">
            {actionMessage}
          </p>
        ) : null}
        {hasCandles ? (
          <p className="load-form-hint">Candles ready — start when you are.</p>
        ) : (
          <p className="load-form-hint">
            Load candles first, then start a locked paper session.
          </p>
        )}
      </section>

      <section className="session-entry-section" aria-labelledby="load-heading">
        <div className="session-list-header">
          <h2 id="load-heading">Load session</h2>
          <button
            type="button"
            onClick={() => {
              void refreshSessionList()
            }}
            disabled={listLoading}
          >
            {listLoading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>

        {listError ? (
          <p className="status-error" role="alert">
            {listError}
          </p>
        ) : null}

        {sessions.length === 0 && !listLoading ? (
          <p className="load-form-hint">No saved sessions yet.</p>
        ) : (
          <ul className="session-list">
            {sessions.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="session-list-item"
                  onClick={() => {
                    void handlePickSession(item.id)
                  }}
                  disabled={loading}
                >
                  <span className="session-list-symbol">{item.symbol}</span>
                  <span className="session-list-meta">
                    {formatWhen(item.updatedAt)} · {item.closedTradeCount}{' '}
                    closed · start {item.startingBalance}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
