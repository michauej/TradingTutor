namespace TradingTutor.Trading.Services;

/// <summary>Thin wrappers over <see cref="IntervalParser"/> for legacy call sites.</summary>
internal static class CandleInterval
{
    public static TimeSpan ToDuration(string interval) => IntervalParser.ToDuration(interval);

    public static int EstimateBarCount(DateTime start, DateTime end, string interval) =>
        IntervalParser.EstimateBarCount(start, end, interval);
}
