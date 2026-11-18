using TradingTutor.Core.Models;
using TradingTutor.Trading.Storage;
using Xunit;

namespace TradingTutor.Tests;

public class CandlePackMergerTests
{
    [Fact]
    public void MergeCandles_EmptyPlusNew_ReturnsIncomingSorted()
    {
        var incoming = new[]
        {
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 2, 0, 0, DateTimeKind.Utc), 102m),
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 1, 0, 0, DateTimeKind.Utc), 100m)
        };

        var merged = CandlePackMerger.MergeCandles(null, incoming);

        Assert.Equal(2, merged.Count);
        Assert.Equal(new DateTime(2024, 1, 1, 1, 0, 0, DateTimeKind.Utc), merged[0].Timestamp);
        Assert.Equal(100m, merged[0].Close);
        Assert.Equal(new DateTime(2024, 1, 1, 2, 0, 0, DateTimeKind.Utc), merged[1].Timestamp);
        Assert.Equal(102m, merged[1].Close);
    }

    [Fact]
    public void MergeCandles_OverlappingRanges_UnionsAndSorts()
    {
        var existing = new[]
        {
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 1, 0, 0, DateTimeKind.Utc), 100m),
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 2, 0, 0, DateTimeKind.Utc), 101m)
        };
        var incoming = new[]
        {
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 2, 0, 0, DateTimeKind.Utc), 111m),
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 3, 0, 0, DateTimeKind.Utc), 103m)
        };

        var merged = CandlePackMerger.MergeCandles(existing, incoming);

        Assert.Equal(3, merged.Count);
        Assert.Equal(100m, merged[0].Close);
        Assert.Equal(111m, merged[1].Close); // later/equal wins
        Assert.Equal(103m, merged[2].Close);
    }

    [Fact]
    public void MergeCandles_DuplicateTimestamps_LaterWins()
    {
        var existing = new[]
        {
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 1, 0, 0, DateTimeKind.Utc), 100m)
        };
        var incoming = new[]
        {
            Candle("BTCUSDT", new DateTime(2024, 1, 1, 1, 0, 0, DateTimeKind.Utc), 200m)
        };

        var merged = CandlePackMerger.MergeCandles(existing, incoming);

        Assert.Single(merged);
        Assert.Equal(200m, merged[0].Close);
    }

    private static MarketData Candle(string symbol, DateTime timestamp, decimal close) =>
        new()
        {
            Symbol = symbol,
            Exchange = "ByBit",
            Interval = "1h",
            Timestamp = timestamp,
            Open = close,
            High = close,
            Low = close,
            Close = close,
            Volume = 1m
        };
}
