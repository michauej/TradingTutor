using TradingTutor.Coaching;
using TradingTutor.Core.Models;
using Xunit;

namespace TradingTutor.Tests;

public class CandlePayloadPolicyTests
{
    [Fact]
    public void Apply_UnderMax_ReturnsUnchangedCount()
    {
        var candles = Enumerable.Range(0, 100).Select(i => new CandleInput
        {
            Timestamp = DateTime.UtcNow.AddMinutes(i),
            Open = 1,
            High = 2,
            Low = 0.5m,
            Close = 1.5m
        }).ToList();

        var result = CandlePayloadPolicy.Apply(candles, []);
        Assert.Equal(100, result.Candles.Count);
        Assert.Null(result.Note);
    }

    [Fact]
    public void Apply_OverMax_DownsamplesAndNotes()
    {
        var candles = Enumerable.Range(0, CandlePayloadPolicy.MaxBars + 500).Select(i => new CandleInput
        {
            Timestamp = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(i),
            Open = 1,
            High = 2,
            Low = 0.5m,
            Close = 1.5m
        }).ToList();

        var trades = new[]
        {
            new ClosedTradeInput
            {
                Id = "t1",
                Side = "long",
                Qty = 1,
                EntryPrice = 1,
                EntryTime = candles[200].Timestamp,
                ExitPrice = 1,
                ExitTime = candles[250].Timestamp,
                RealizedPnl = 0
            }
        };

        var result = CandlePayloadPolicy.Apply(candles, trades);
        Assert.True(result.Candles.Count <= CandlePayloadPolicy.MaxBars);
        Assert.NotNull(result.Note);
        Assert.Contains("downsampled", result.Note, StringComparison.OrdinalIgnoreCase);
    }
}
