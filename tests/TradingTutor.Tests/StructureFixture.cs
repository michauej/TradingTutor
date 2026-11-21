using System.Text.Json;
using TradingTutor.Core.Models;

namespace TradingTutor.Tests;

/// <summary>
/// Shared OHLC + trade fixtures for structure/ICT tests (parity with frontend structure-ohlc.json).
/// </summary>
public static class StructureFixture
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static IReadOnlyList<CandleInput> LoadGoldenOhlc()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "structure-ohlc.json");
        if (!File.Exists(path))
        {
            // Fall back to source-relative path when not copied to output.
            path = Path.GetFullPath(Path.Combine(
                AppContext.BaseDirectory,
                "..", "..", "..", "Fixtures", "structure-ohlc.json"));
        }

        var json = File.ReadAllText(path);
        var rows = JsonSerializer.Deserialize<List<OhlcRow>>(json, JsonOptions)
                   ?? throw new InvalidOperationException("Failed to deserialize structure-ohlc.json");
        return rows.Select(r => new CandleInput
        {
            Timestamp = DateTime.Parse(r.Timestamp, null, System.Globalization.DateTimeStyles.RoundtripKind),
            Open = r.Open,
            High = r.High,
            Low = r.Low,
            Close = r.Close
        }).ToList();
    }

    /// <summary>
    /// Synthetic series: swings at 90–110, equilibrium 100, clear bullish FVG mid-series.
    /// </summary>
    public static List<CandleInput> BuildPremiumDiscountSeries()
    {
        var t0 = new DateTime(2024, 6, 1, 12, 0, 0, DateTimeKind.Utc);
        // Build enough bars for lookback=2 swings + a bullish FVG.
        var bars = new List<CandleInput>();
        decimal[] closes =
        [
            100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, // down to swing low
            91, 92, 93, 94, 95, 96, 97, 98, 99, 100,
            101, 102, 103, 104, 105, 106, 107, 108, 109, 110, // swing high area
            109, 108, 107, 106, 105, 104, 103, 102, 101, 100,
            // bullish FVG: left high 100, mid impulse, right low 102
            100, 101, 103
        ];

        for (var i = 0; i < closes.Length; i++)
        {
            var c = closes[i];
            var o = i == 0 ? c : closes[i - 1];
            bars.Add(new CandleInput
            {
                Timestamp = t0.AddMinutes(i),
                Open = o,
                High = Math.Max(o, c) + 0.3m,
                Low = Math.Min(o, c) - 0.3m,
                Close = c
            });
        }

        // Force an explicit bullish FVG at the end: left.high < right.low
        var n = bars.Count;
        bars[n - 3] = new CandleInput
        {
            Timestamp = bars[n - 3].Timestamp,
            Open = 100m,
            High = 100.2m,
            Low = 99.5m,
            Close = 100m
        };
        bars[n - 2] = new CandleInput
        {
            Timestamp = bars[n - 2].Timestamp,
            Open = 100.2m,
            High = 102.5m,
            Low = 100.1m,
            Close = 102.4m
        };
        bars[n - 1] = new CandleInput
        {
            Timestamp = bars[n - 1].Timestamp,
            Open = 102.4m,
            High = 103.5m,
            Low = 102.3m, // > left.high 100.2 → bullish FVG
            Close = 103m
        };

        return bars;
    }

    public static List<ClosedTradeInput> BuildPremiumLongTrades()
    {
        var t0 = new DateTime(2024, 6, 1, 12, 40, 0, DateTimeKind.Utc);
        // Five longs entered in premium (~108)
        return Enumerable.Range(1, 5).Select(i => new ClosedTradeInput
        {
            Id = $"p{i}",
            Side = "long",
            Qty = 1m,
            EntryPrice = 108m,
            EntryTime = t0.AddMinutes(i),
            ExitPrice = 107m,
            ExitTime = t0.AddMinutes(i + 2),
            RealizedPnl = -1m
        }).ToList();
    }

    private sealed class OhlcRow
    {
        public string Timestamp { get; set; } = "";
        public decimal Open { get; set; }
        public decimal High { get; set; }
        public decimal Low { get; set; }
        public decimal Close { get; set; }
    }
}
