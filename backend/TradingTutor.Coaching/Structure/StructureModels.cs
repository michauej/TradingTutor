namespace TradingTutor.Coaching.Structure;

/// <summary>
/// Swing pivot. Lookback = 5 on each side (same as client <c>detectSwings</c>).
/// A bar is a swing high when its high is strictly greater than the highs of
/// the <c>lookback</c> bars on both sides; swing low uses lows symmetrically.
/// After raw detection: SH/SL alternate, same-type keeps the more extreme,
/// opposite pivots must clear min amplitude, and each pivot must have a meaningful
/// leg on BOTH sides (ATR/% floor) so shallow pullbacks and unconfirmed edge pivots drop.
/// </summary>
public sealed record SwingPoint(int Index, DateTime Timestamp, decimal Price, bool IsHigh);

/// <summary>
/// Fair value gap via the three-candle rule (same as client <c>detectFvg</c>):
/// bullish when candle[i-2].High &lt; candle[i].Low; bearish when candle[i-2].Low &gt; candle[i].High.
/// Zone is the gap between those prices; time spans candle[i-2] → candle[i].
/// </summary>
public sealed record FvgZone(
    int MidIndex,
    DateTime Start,
    DateTime End,
    decimal Low,
    decimal High,
    bool IsBullish);

/// <summary>
/// Extreme order block at a swing extreme (same as client <c>detectExtremeOb</c>):
/// bullish EOB = last bearish candle at/near a swing low; bearish EOB = last bullish candle at/near a swing high.
/// Zone is that candle's high–low. Time always covers the OB candle plus the next bar
/// (extension; that adjacent bar is never "taken"). A 50% take is valid only after price
/// has first left the OB, then returns to <see cref="Mean"/>; otherwise extends to last bar.
/// </summary>
public sealed record ExtremeOrderBlock(
    int CandleIndex,
    int SwingIndex,
    int EndIndex,
    DateTime Start,
    DateTime End,
    decimal Low,
    decimal High,
    bool IsBullish)
{
    /// <summary>50% mean threshold of the OB range — preferred mitigation / entry level.</summary>
    public decimal Mean => (Low + High) / 2m;
}

/// <summary>
/// Premium / discount range from the most recent swing low → swing high pair
/// (or session min/max fallback). Equilibrium = midpoint; premium above, discount below.
/// </summary>
public sealed record PremiumDiscountRange(
    decimal Low,
    decimal High,
    decimal Equilibrium);
