/** Minimum closed trades required before Analyze is enabled (US-01 / FR-010). */
export const MIN_CLOSED_TRADES_FOR_ANALYZE = 5

export interface AnalyzeGate {
  canAnalyze: boolean
  remainingToAnalyze: number
  hint: string
}

export function getAnalyzeGate(closedTradeCount: number): AnalyzeGate {
  const remainingToAnalyze = Math.max(
    0,
    MIN_CLOSED_TRADES_FOR_ANALYZE - closedTradeCount,
  )
  const canAnalyze = remainingToAnalyze === 0
  const hint = canAnalyze
    ? ''
    : remainingToAnalyze === 1
      ? 'Need 1 more closed trade to analyze.'
      : `Need ${remainingToAnalyze} more closed trades to analyze.`

  return { canAnalyze, remainingToAnalyze, hint }
}
