import type { CoachRuleFinding } from '../services/api'

export interface CritiqueCard {
  id: string
  severity: string
  /** Bad: related trade ids or rule id fallback. */
  bad: string
  /** Why: rule message. */
  why: string
  /** Better: zone text when present, else qualitative alternativeSummary / message. */
  better: string
  biasLabel?: string | null
  hasZone: boolean
  /** Trade ids referenced by this finding (for Show-on-chart filter). */
  relatedTradeIds: string[]
}

export function toCritiqueCard(finding: CoachRuleFinding): CritiqueCard {
  const related =
    finding.relatedTradeIds?.filter((id) => id.trim().length > 0) ?? []
  const bad =
    related.length > 0
      ? `Trade(s): ${related.join(', ')}`
      : `Signal: ${finding.id}`

  const hasZone =
    finding.betterZoneLow != null &&
    finding.betterZoneHigh != null &&
    Number.isFinite(finding.betterZoneLow) &&
    Number.isFinite(finding.betterZoneHigh)

  let better: string
  if (hasZone) {
    const low = finding.betterZoneLow!
    const high = finding.betterZoneHigh!
    const zoneText = `Better zone: ${formatNum(low)} – ${formatNum(high)}`
    better = finding.alternativeSummary
      ? `${finding.alternativeSummary} (${zoneText})`
      : zoneText
  } else if (finding.alternativeSummary?.trim()) {
    better = finding.alternativeSummary.trim()
  } else {
    better = 'See analysis for a qualitative alternative (no numeric zone).'
  }

  return {
    id: finding.id,
    severity: finding.severity,
    bad,
    why: finding.message,
    better,
    biasLabel: finding.biasLabel,
    hasZone,
    relatedTradeIds: related,
  }
}

function formatNum(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 })
}
