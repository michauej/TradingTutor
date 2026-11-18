using TradingTutor.Core.Models;

namespace TradingTutor.Trading.Storage;

public static class CandlePackMerger
{
    /// <summary>
    /// Unions candles by Timestamp (later/equal bar wins on collision), sorts ascending.
    /// </summary>
    public static List<MarketData> MergeCandles(
        IEnumerable<MarketData>? existing,
        IEnumerable<MarketData>? incoming)
    {
        var byTimestamp = new Dictionary<DateTime, MarketData>();

        foreach (var candle in existing ?? [])
        {
            byTimestamp[NormalizeTimestamp(candle.Timestamp)] = candle;
        }

        foreach (var candle in incoming ?? [])
        {
            byTimestamp[NormalizeTimestamp(candle.Timestamp)] = candle;
        }

        return byTimestamp
            .OrderBy(pair => pair.Key)
            .Select(pair => pair.Value)
            .ToList();
    }

    public static CandlePack MergePack(
        CandlePack? existing,
        IReadOnlyList<MarketData> incoming,
        string exchange,
        string symbol,
        string interval,
        DateTime? requestedStart,
        DateTime? requestedEnd,
        bool incomplete,
        DateTime updatedAt)
    {
        var mergedCandles = MergeCandles(existing?.Candles, incoming);

        return new CandlePack
        {
            Exchange = exchange,
            Symbol = symbol.ToUpperInvariant(),
            Interval = interval,
            Incomplete = incomplete,
            RequestedStart = requestedStart,
            RequestedEnd = requestedEnd,
            UpdatedAt = updatedAt,
            Candles = mergedCandles
        };
    }

    private static DateTime NormalizeTimestamp(DateTime timestamp) =>
        DateTime.SpecifyKind(timestamp, DateTimeKind.Utc);
}
