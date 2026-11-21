using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Structure;

/// <summary>
/// Pure structure helpers over posted candles. Definitions must stay in lockstep
/// with frontend <c>detectSwings</c> / <c>detectFvg</c> / <c>detectExtremeOb</c>
/// (lookback=5, min amplitude, three-candle FVG, alternating SH/SL, extreme OB).
/// </summary>
public static class StructureDetector
{
    /// <summary>Bars on each side required to confirm a swing.</summary>
    public const int DefaultSwingLookback = 5;

    /// <summary>
    /// Minimum |Δprice|/price between consecutive opposite swings (0.5%).
    /// Smaller opposite pivots are ignored as noise.
    /// </summary>
    public const decimal MinSwingAmplitudeRatio = 0.005m;

    /// <summary>ATR length for adaptive min leg size.</summary>
    public const int SwingAtrPeriod = 14;

    /// <summary>Min left/right leg size as a multiple of ATR.</summary>
    public const decimal MinSwingAtrMult = 0.75m;

    /// <summary>How far before a swing to search for the extreme OB candle.</summary>
    public const int ExtremeObLookback = 3;

    public static IReadOnlyList<SwingPoint> DetectSwings(
        IReadOnlyList<CandleInput> candles,
        int lookback = DefaultSwingLookback)
    {
        ArgumentNullException.ThrowIfNull(candles);
        if (lookback < 1 || candles.Count < lookback * 2 + 1)
        {
            return [];
        }

        var raw = new List<SwingPoint>();
        for (var i = lookback; i < candles.Count - lookback; i++)
        {
            var c = candles[i];
            var isHigh = true;
            var isLow = true;
            for (var k = 1; k <= lookback; k++)
            {
                if (c.High <= candles[i - k].High || c.High <= candles[i + k].High)
                {
                    isHigh = false;
                }

                if (c.Low >= candles[i - k].Low || c.Low >= candles[i + k].Low)
                {
                    isLow = false;
                }
            }

            // Same bar cannot be both SH and SL — prefer the more decisive wick vs mid.
            if (isHigh && isLow)
            {
                var mid = (c.High + c.Low) / 2m;
                var highDist = c.High - mid;
                var lowDist = mid - c.Low;
                if (highDist >= lowDist)
                {
                    isLow = false;
                }
                else
                {
                    isHigh = false;
                }
            }

            if (isHigh)
            {
                raw.Add(new SwingPoint(i, c.Timestamp, c.High, IsHigh: true));
            }

            if (isLow)
            {
                raw.Add(new SwingPoint(i, c.Timestamp, c.Low, IsHigh: false));
            }
        }

        var alternating = AlternateSwings(raw, MinSwingAmplitudeRatio);
        var atr = AverageTrueRange(candles, SwingAtrPeriod);
        return FilterSignificantSwings(candles, alternating, lookback, atr, MinSwingAmplitudeRatio);
    }

    /// <summary>
    /// Enforce alternating SH/SL. Consecutive same-type pivots keep the more extreme
    /// (higher high / lower low). Opposite pivots must clear
    /// <paramref name="minAmplitudeRatio"/> or they are dropped as micro-swings.
    /// Matches client <c>alternateSwings</c>.
    /// </summary>
    public static IReadOnlyList<SwingPoint> AlternateSwings(
        IReadOnlyList<SwingPoint> raw,
        decimal minAmplitudeRatio = MinSwingAmplitudeRatio)
    {
        if (raw.Count == 0)
        {
            return [];
        }

        var ordered = raw.OrderBy(s => s.Index).ThenBy(s => s.IsHigh ? 0 : 1).ToList();
        var result = new List<SwingPoint> { ordered[0] };
        for (var i = 1; i < ordered.Count; i++)
        {
            var next = ordered[i];
            var last = result[^1];
            if (next.IsHigh == last.IsHigh)
            {
                var keepNext = next.IsHigh
                    ? next.Price > last.Price
                    : next.Price < last.Price;
                if (keepNext)
                {
                    result[^1] = next;
                }
            }
            else if (HasMinAmplitude(last.Price, next.Price, minAmplitudeRatio))
            {
                result.Add(next);
            }
            // else: opposite pivot too small — ignore (noise)
        }

        return result;
    }

    /// <summary>
    /// Keep pivots with a meaningful leg on BOTH sides (ATR / % floor).
    /// Drops shallow pullback highs and unconfirmed trailing lows/highs.
    /// Matches client <c>filterSignificantSwings</c>.
    /// </summary>
    public static IReadOnlyList<SwingPoint> FilterSignificantSwings(
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<SwingPoint> swings,
        int lookback,
        decimal atr,
        decimal minAmplitudeRatio = MinSwingAmplitudeRatio)
    {
        if (swings.Count == 0)
        {
            return [];
        }

        var kept = new List<SwingPoint>();
        foreach (var swing in swings)
        {
            var minMove = MinSwingMove(swing.Price, atr, minAmplitudeRatio);
            if (HasSignificantLegs(candles, swing, lookback, minMove))
            {
                kept.Add(swing);
            }
        }

        return AlternateSwings(kept, minAmplitudeRatio);
    }

    public static bool HasSignificantLegs(
        IReadOnlyList<CandleInput> candles,
        SwingPoint swing,
        int lookback,
        decimal minMove)
    {
        var leftFrom = Math.Max(0, swing.Index - lookback * 2);
        var rightTo = Math.Min(candles.Count - 1, swing.Index + lookback * 2);
        if (swing.Index <= leftFrom || swing.Index >= rightTo)
        {
            return false;
        }

        decimal leftLeg;
        decimal rightLeg;
        if (swing.IsHigh)
        {
            var leftLow = candles[swing.Index].Low;
            for (var i = leftFrom; i < swing.Index; i++)
            {
                leftLow = Math.Min(leftLow, candles[i].Low);
            }

            var rightLow = candles[swing.Index].Low;
            for (var i = swing.Index + 1; i <= rightTo; i++)
            {
                rightLow = Math.Min(rightLow, candles[i].Low);
            }

            leftLeg = swing.Price - leftLow;
            rightLeg = swing.Price - rightLow;
        }
        else
        {
            var leftHigh = candles[swing.Index].High;
            for (var i = leftFrom; i < swing.Index; i++)
            {
                leftHigh = Math.Max(leftHigh, candles[i].High);
            }

            var rightHigh = candles[swing.Index].High;
            for (var i = swing.Index + 1; i <= rightTo; i++)
            {
                rightHigh = Math.Max(rightHigh, candles[i].High);
            }

            leftLeg = leftHigh - swing.Price;
            rightLeg = rightHigh - swing.Price;
        }

        return leftLeg >= minMove && rightLeg >= minMove;
    }

    public static decimal MinSwingMove(decimal price, decimal atr, decimal minAmplitudeRatio)
    {
        var pctFloor = Math.Abs(price) * minAmplitudeRatio;
        var atrFloor = atr > 0m ? atr * MinSwingAtrMult : 0m;
        return Math.Max(pctFloor, atrFloor);
    }

    public static decimal AverageTrueRange(IReadOnlyList<CandleInput> candles, int period = SwingAtrPeriod)
    {
        if (candles.Count < 2)
        {
            return 0m;
        }

        var trs = new List<decimal>();
        for (var i = 1; i < candles.Count; i++)
        {
            var cur = candles[i];
            var prev = candles[i - 1];
            var tr = Math.Max(
                cur.High - cur.Low,
                Math.Max(Math.Abs(cur.High - prev.Close), Math.Abs(cur.Low - prev.Close)));
            trs.Add(tr);
        }

        if (trs.Count == 0)
        {
            return 0m;
        }

        var take = Math.Min(period, trs.Count);
        return trs.Skip(trs.Count - take).Average();
    }

    public static bool HasMinAmplitude(decimal fromPrice, decimal toPrice, decimal minAmplitudeRatio)
    {
        var basis = Math.Abs(fromPrice);
        if (basis <= 0m)
        {
            return Math.Abs(toPrice - fromPrice) > 0m;
        }

        return Math.Abs(toPrice - fromPrice) / basis >= minAmplitudeRatio;
    }

    public static IReadOnlyList<FvgZone> DetectFvgs(IReadOnlyList<CandleInput> candles)
    {
        ArgumentNullException.ThrowIfNull(candles);
        if (candles.Count < 3)
        {
            return [];
        }

        var zones = new List<FvgZone>();
        for (var i = 2; i < candles.Count; i++)
        {
            var left = candles[i - 2];
            var right = candles[i];

            // Bullish FVG: gap up between left.high and right.low
            if (left.High < right.Low)
            {
                zones.Add(new FvgZone(
                    MidIndex: i - 1,
                    Start: left.Timestamp,
                    End: right.Timestamp,
                    Low: left.High,
                    High: right.Low,
                    IsBullish: true));
            }

            // Bearish FVG: gap down between right.high and left.low
            if (left.Low > right.High)
            {
                zones.Add(new FvgZone(
                    MidIndex: i - 1,
                    Start: left.Timestamp,
                    End: right.Timestamp,
                    Low: right.High,
                    High: left.Low,
                    IsBullish: false));
            }
        }

        return zones;
    }

    /// <summary>
    /// Extreme order blocks at swing extremes. Uses alternating swings from
    /// <see cref="DetectSwings"/> when <paramref name="swings"/> is null.
    /// Each OB extends right until the 50% mean threshold is taken (or series end).
    /// </summary>
    public static IReadOnlyList<ExtremeOrderBlock> DetectExtremeOrderBlocks(
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<SwingPoint>? swings = null)
    {
        ArgumentNullException.ThrowIfNull(candles);
        swings ??= DetectSwings(candles);
        if (candles.Count == 0 || swings.Count == 0)
        {
            return [];
        }

        var blocks = new List<ExtremeOrderBlock>();
        foreach (var swing in swings)
        {
            var from = Math.Max(0, swing.Index - ExtremeObLookback);
            int? obIndex = null;
            var isBullish = false;

            for (var i = swing.Index; i >= from; i--)
            {
                var c = candles[i];
                var bearish = c.Close < c.Open;
                var bullish = c.Close > c.Open;

                if (!swing.IsHigh && bearish)
                {
                    // Bullish extreme OB: last down candle into the swing low.
                    obIndex = i;
                    isBullish = true;
                    break;
                }

                if (swing.IsHigh && bullish)
                {
                    // Bearish extreme OB: last up candle into the swing high.
                    obIndex = i;
                    isBullish = false;
                    break;
                }
            }

            if (obIndex is null)
            {
                continue;
            }

            var obCandle = candles[obIndex.Value];
            var endIndex = FindMeanTakeIndex(
                candles,
                obIndex.Value,
                obCandle.Low,
                obCandle.High,
                isBullish);

            blocks.Add(new ExtremeOrderBlock(
                CandleIndex: obIndex.Value,
                SwingIndex: swing.Index,
                EndIndex: endIndex,
                Start: obCandle.Timestamp,
                End: candles[endIndex].Timestamp,
                Low: obCandle.Low,
                High: obCandle.High,
                IsBullish: isBullish));
        }

        return blocks;
    }

    /// <summary>
    /// Extend the OB at least through the candle immediately to its right (that bar is part of
    /// the OB extension, never a "taken" event). A 50% take is allowed only after price has
    /// first left the OB range (bullish: high &gt; OB high; bearish: low &lt; OB low). Then walk
    /// until the mean is taken, else last bar. Bullish take: low &lt;= mean. Bearish: high &gt;= mean.
    /// </summary>
    public static int FindMeanTakeIndex(
        IReadOnlyList<CandleInput> candles,
        int obIndex,
        decimal low,
        decimal high,
        bool isBullish)
    {
        var mean = (low + high) / 2m;
        var endIndex = candles.Count - 1;
        var minExtend = Math.Min(obIndex + 1, endIndex);
        var leftOb = false;
        // Adjacent (obIndex+1) may establish "left OB" but never counts as a take.
        for (var i = obIndex + 1; i < candles.Count; i++)
        {
            var c = candles[i];
            if (!leftOb)
            {
                if (isBullish && c.High > high)
                {
                    leftOb = true;
                }
                else if (!isBullish && c.Low < low)
                {
                    leftOb = true;
                }
            }

            if (i == obIndex + 1)
            {
                continue;
            }

            if (!leftOb)
            {
                continue;
            }

            if (isBullish && c.Low <= mean)
            {
                return Math.Max(i, minExtend);
            }

            if (!isBullish && c.High >= mean)
            {
                return Math.Max(i, minExtend);
            }
        }

        return endIndex;
    }

    public static PremiumDiscountRange? ComputePremiumDiscount(
        IReadOnlyList<CandleInput> candles,
        IReadOnlyList<SwingPoint>? swings = null)
    {
        ArgumentNullException.ThrowIfNull(candles);
        if (candles.Count == 0)
        {
            return null;
        }

        swings ??= DetectSwings(candles);
        var highs = swings.Where(s => s.IsHigh).ToList();
        var lows = swings.Where(s => !s.IsHigh).ToList();

        decimal rangeHigh;
        decimal rangeLow;
        if (highs.Count > 0 && lows.Count > 0)
        {
            rangeHigh = highs[^1].Price;
            rangeLow = lows[^1].Price;
            // Ensure ordering if last swing high is below last swing low.
            if (rangeHigh < rangeLow)
            {
                (rangeHigh, rangeLow) = (rangeLow, rangeHigh);
            }
        }
        else
        {
            rangeHigh = candles.Max(c => c.High);
            rangeLow = candles.Min(c => c.Low);
        }

        if (rangeHigh <= rangeLow)
        {
            return null;
        }

        var eq = (rangeHigh + rangeLow) / 2m;
        return new PremiumDiscountRange(rangeLow, rangeHigh, eq);
    }

    /// <summary>
    /// Index of the candle whose timestamp is nearest to <paramref name="time"/> (UTC).
    /// </summary>
    public static int NearestCandleIndex(IReadOnlyList<CandleInput> candles, DateTime time)
    {
        var target = time.ToUniversalTime();
        var best = 0;
        var bestDelta = long.MaxValue;
        for (var i = 0; i < candles.Count; i++)
        {
            var delta = Math.Abs((candles[i].Timestamp.ToUniversalTime() - target).Ticks);
            if (delta < bestDelta)
            {
                bestDelta = delta;
                best = i;
            }
        }

        return best;
    }
}
