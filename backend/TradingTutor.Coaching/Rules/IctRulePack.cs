using TradingTutor.Coaching.Structure;
using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// ICT didactic rule pack. Requires a non-empty candle prefix on the evaluation context.
/// Findings are aggregated by rule with related trade ids; better zones sit on the finding.
/// </summary>
public sealed class IctRulePack : IRulePack
{
    public const string PackIdValue = "ict";

    public string PackId => PackIdValue;

    public IReadOnlyList<RuleFinding> Evaluate(RuleEvaluationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(context.Trades);

        var candles = context.Candles;
        if (candles is null || candles.Count == 0)
        {
            throw new ArgumentException(
                "ICT rule pack requires a non-empty candles array (session candle prefix).");
        }

        if (context.Trades.Count == 0)
        {
            return [];
        }

        var ordered = candles.OrderBy(c => c.Timestamp).ToList();
        var swings = StructureDetector.DetectSwings(ordered);
        var fvgs = StructureDetector.DetectFvgs(ordered);
        var extremeObs = StructureDetector.DetectExtremeOrderBlocks(ordered, swings);
        var pd = StructureDetector.ComputePremiumDiscount(ordered, swings);

        var findings = new List<RuleFinding>();
        findings.AddRange(EvaluatePremiumDiscount(context.Trades, pd));
        findings.AddRange(EvaluateLiquiditySwing(context.Trades, ordered, swings));
        findings.AddRange(EvaluateFvgInteraction(context.Trades, ordered, fvgs));
        findings.AddRange(EvaluateOrderBlockHeuristic(context.Trades, ordered, swings));
        findings.AddRange(EvaluateExtremeOrderBlock(context.Trades, ordered, extremeObs));
        findings.AddRange(EvaluateBosChochHint(context.Trades, ordered, swings));
        return findings;
    }

    private static IEnumerable<RuleFinding> EvaluatePremiumDiscount(
        IReadOnlyList<ClosedTradeInput> trades,
        PremiumDiscountRange? pd)
    {
        if (pd is null)
        {
            yield break;
        }

        var related = new List<string>();
        foreach (var t in trades)
        {
            var isLong = string.Equals(t.Side, "long", StringComparison.OrdinalIgnoreCase);
            if (isLong && t.EntryPrice > pd.Equilibrium)
            {
                related.Add(t.Id);
            }
            else if (!isLong && t.EntryPrice < pd.Equilibrium)
            {
                related.Add(t.Id);
            }
        }

        if (related.Count == 0)
        {
            yield break;
        }

        var longIntoPremium = trades.Any(t =>
            string.Equals(t.Side, "long", StringComparison.OrdinalIgnoreCase) &&
            t.EntryPrice > pd.Equilibrium);

        yield return new RuleFinding
        {
            Id = "ict-premium-discount",
            Severity = "warning",
            Message = longIntoPremium
                ? $"Long entry into premium (above equilibrium {pd.Equilibrium:F2}). Prefer discount array for buys."
                : $"Short entry into discount (below equilibrium {pd.Equilibrium:F2}). Prefer premium array for sells.",
            RelatedTradeIds = related,
            AlternativeSummary = longIntoPremium
                ? "Wait for a discount (below equilibrium) long instead of buying premium."
                : "Wait for a premium (above equilibrium) short instead of selling discount.",
            BetterZoneLow = longIntoPremium ? pd.Low : pd.Equilibrium,
            BetterZoneHigh = longIntoPremium ? pd.Equilibrium : pd.High,
            BiasLabel = "FOMO"
        };
    }

    private static IEnumerable<RuleFinding> EvaluateLiquiditySwing(
        IReadOnlyList<ClosedTradeInput> trades,
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<SwingPoint> swings)
    {
        if (swings.Count == 0)
        {
            yield break;
        }

        var related = new List<string>();
        foreach (var t in trades)
        {
            var entryIdx = StructureDetector.NearestCandleIndex(candles, t.EntryTime);
            var nearby = swings
                .Where(s => Math.Abs(s.Index - entryIdx) <= 3)
                .ToList();
            if (nearby.Count == 0)
            {
                continue;
            }

            var isLong = string.Equals(t.Side, "long", StringComparison.OrdinalIgnoreCase);
            foreach (var s in nearby)
            {
                if (isLong && s.IsHigh && t.EntryPrice >= s.Price * 0.999m)
                {
                    related.Add(t.Id);
                    break;
                }

                if (!isLong && !s.IsHigh && t.EntryPrice <= s.Price * 1.001m)
                {
                    related.Add(t.Id);
                    break;
                }
            }
        }

        if (related.Count == 0)
        {
            yield break;
        }

        var lastLow = swings.LastOrDefault(s => !s.IsHigh);
        yield return new RuleFinding
        {
            Id = "ict-liquidity-swing",
            Severity = "warning",
            Message =
                "Entry interacted with swing liquidity in a chase-like way (buying swing highs / selling swing lows).",
            RelatedTradeIds = related.Distinct().ToList(),
            AlternativeSummary =
                "Let liquidity be taken first, then enter on the displacement back into the range.",
            BetterZoneLow = lastLow?.Price,
            BetterZoneHigh = lastLow is null ? null : lastLow.Price * 1.002m,
            BetterZoneStart = lastLow?.Timestamp,
            BiasLabel = "recency bias"
        };
    }

    private static IEnumerable<RuleFinding> EvaluateFvgInteraction(
        IReadOnlyList<ClosedTradeInput> trades,
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<FvgZone> fvgs)
    {
        if (fvgs.Count == 0)
        {
            yield break;
        }

        var related = new List<string>();
        FvgZone? example = null;
        foreach (var t in trades)
        {
            var entryIdx = StructureDetector.NearestCandleIndex(candles, t.EntryTime);
            foreach (var fvg in fvgs)
            {
                var inGap = t.EntryPrice >= fvg.Low && t.EntryPrice <= fvg.High;
                var nearInTime = entryIdx >= fvg.MidIndex && entryIdx <= fvg.MidIndex + 4;
                if (!inGap && !nearInTime)
                {
                    continue;
                }

                var isLong = string.Equals(t.Side, "long", StringComparison.OrdinalIgnoreCase);
                if (isLong && fvg.IsBullish && t.EntryPrice >= fvg.High)
                {
                    related.Add(t.Id);
                    example ??= fvg;
                }
                else if (!isLong && !fvg.IsBullish && t.EntryPrice <= fvg.Low)
                {
                    related.Add(t.Id);
                    example ??= fvg;
                }
                else if (inGap)
                {
                    related.Add(t.Id);
                    example ??= fvg;
                }
            }
        }

        if (related.Count == 0)
        {
            yield break;
        }

        yield return new RuleFinding
        {
            Id = "ict-fvg-interaction",
            Severity = "warning",
            Message =
                "Trade interacted with a fair value gap in a chase-like way (entered through/above the gap instead of waiting for a rebalance).",
            RelatedTradeIds = related.Distinct().ToList(),
            AlternativeSummary = "Wait for price to rebalance into the FVG before entering.",
            BetterZoneLow = example?.Low,
            BetterZoneHigh = example?.High,
            BetterZoneStart = example?.Start,
            BetterZoneEnd = example?.End,
            BiasLabel = "FOMO"
        };
    }

    private static IEnumerable<RuleFinding> EvaluateOrderBlockHeuristic(
        IReadOnlyList<ClosedTradeInput> trades,
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<SwingPoint> swings)
    {
        if (candles.Count < 5 || swings.Count == 0)
        {
            yield break;
        }

        var related = new List<string>();
        decimal? zoneLow = null;
        decimal? zoneHigh = null;
        DateTime? zoneStart = null;

        foreach (var t in trades)
        {
            var entryIdx = StructureDetector.NearestCandleIndex(candles, t.EntryTime);
            if (entryIdx < 2)
            {
                continue;
            }

            var isLong = string.Equals(t.Side, "long", StringComparison.OrdinalIgnoreCase);
            for (var i = entryIdx - 1; i >= Math.Max(1, entryIdx - 6); i--)
            {
                var c = candles[i];
                var bullishBody = c.Close > c.Open;
                var bearishBody = c.Close < c.Open;
                if (isLong && bearishBody)
                {
                    if (t.EntryPrice > c.High * 1.002m)
                    {
                        related.Add(t.Id);
                        zoneLow = c.Low;
                        zoneHigh = c.High;
                        zoneStart = c.Timestamp;
                    }

                    break;
                }

                if (!isLong && bullishBody)
                {
                    if (t.EntryPrice < c.Low * 0.998m)
                    {
                        related.Add(t.Id);
                        zoneLow = c.Low;
                        zoneHigh = c.High;
                        zoneStart = c.Timestamp;
                    }

                    break;
                }
            }
        }

        if (related.Count == 0)
        {
            yield break;
        }

        yield return new RuleFinding
        {
            Id = "ict-order-block",
            Severity = "info",
            Message =
                "Entry appears to have skipped a nearby opposing candle (order-block heuristic) and chased price instead.",
            RelatedTradeIds = related.Distinct().ToList(),
            AlternativeSummary = "Prefer entries that mitigate into the order block rather than chasing the impulse.",
            BetterZoneLow = zoneLow,
            BetterZoneHigh = zoneHigh,
            BetterZoneStart = zoneStart,
            BiasLabel = "anchoring"
        };
    }

    private static IEnumerable<RuleFinding> EvaluateExtremeOrderBlock(
        IReadOnlyList<ClosedTradeInput> trades,
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<ExtremeOrderBlock> extremeObs)
    {
        if (extremeObs.Count == 0)
        {
            yield break;
        }

        var related = new List<string>();
        ExtremeOrderBlock? example = null;

        foreach (var t in trades)
        {
            var entryIdx = StructureDetector.NearestCandleIndex(candles, t.EntryTime);
            var isLong = string.Equals(t.Side, "long", StringComparison.OrdinalIgnoreCase);

            foreach (var ob in extremeObs)
            {
                if (ob.SwingIndex > entryIdx)
                {
                    continue;
                }

                var mean = ob.Mean;
                if (isLong && ob.IsBullish && t.EntryPrice > mean * 1.002m)
                {
                    related.Add(t.Id);
                    example ??= ob;
                }
                else if (!isLong && !ob.IsBullish && t.EntryPrice < mean * 0.998m)
                {
                    related.Add(t.Id);
                    example ??= ob;
                }
            }
        }

        if (related.Count == 0)
        {
            yield break;
        }

        var meanLevel = example?.Mean;
        yield return new RuleFinding
        {
            Id = "ict-extreme-ob",
            Severity = "warning",
            Message =
                "Entry skipped the extreme order block 50% mean threshold (chased instead of taking the OB at half).",
            RelatedTradeIds = related.Distinct().ToList(),
            AlternativeSummary =
                "Wait to take the extreme OB at its 50% mean threshold before entering.",
            BetterZoneLow = meanLevel,
            BetterZoneHigh = meanLevel,
            BetterZoneStart = example?.Start,
            BetterZoneEnd = example?.End,
            BiasLabel = "FOMO"
        };
    }

    private static IEnumerable<RuleFinding> EvaluateBosChochHint(
        IReadOnlyList<ClosedTradeInput> trades,
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<SwingPoint> swings)
    {
        var swingHighs = swings.Where(s => s.IsHigh).ToList();
        var swingLows = swings.Where(s => !s.IsHigh).ToList();
        if (swingHighs.Count == 0 && swingLows.Count == 0)
        {
            yield break;
        }

        var related = new List<string>();
        foreach (var t in trades)
        {
            var entryIdx = StructureDetector.NearestCandleIndex(candles, t.EntryTime);
            var isLong = string.Equals(t.Side, "long", StringComparison.OrdinalIgnoreCase);

            if (isLong)
            {
                var priorHigh = swingHighs.LastOrDefault(s => s.Index < entryIdx);
                if (priorHigh is not null && t.EntryPrice > priorHigh.Price)
                {
                    var pulledBack = candles
                        .Skip(priorHigh.Index)
                        .Take(entryIdx - priorHigh.Index + 1)
                        .Any(c => c.Low < priorHigh.Price);
                    if (!pulledBack)
                    {
                        related.Add(t.Id);
                    }
                }
            }
            else
            {
                var priorLow = swingLows.LastOrDefault(s => s.Index < entryIdx);
                if (priorLow is not null && t.EntryPrice < priorLow.Price)
                {
                    var pulledBack = candles
                        .Skip(priorLow.Index)
                        .Take(entryIdx - priorLow.Index + 1)
                        .Any(c => c.High > priorLow.Price);
                    if (!pulledBack)
                    {
                        related.Add(t.Id);
                    }
                }
            }
        }

        if (related.Count == 0)
        {
            yield break;
        }

        yield return new RuleFinding
        {
            Id = "ict-bos-choch",
            Severity = "info",
            Message =
                "Possible BOS/ChoCH chase: entered in the breakout direction without a pullback into the broken level.",
            RelatedTradeIds = related.Distinct().ToList(),
            AlternativeSummary =
                "After BOS/ChoCH, wait for a retest of the broken swing before committing.",
            BiasLabel = "FOMO"
        };
    }
}
