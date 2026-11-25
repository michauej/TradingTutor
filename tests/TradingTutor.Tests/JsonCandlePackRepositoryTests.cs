using Microsoft.Extensions.Options;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Options;
using TradingTutor.Trading.Storage;
using Xunit;

namespace TradingTutor.Tests;

public class JsonCandlePackRepositoryTests
{
    [Fact]
    public async Task SaveAndGet_RoundTripsPackIncludingIncompleteFlag()
    {
        var root = CreateTempRoot();
        try
        {
            var repo = CreateRepository(root);
            var pack = new CandlePack
            {
                Exchange = "ByBit",
                Symbol = "BTCUSDT",
                Interval = "1h",
                Incomplete = true,
                RequestedStart = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                RequestedEnd = new DateTime(2024, 1, 2, 0, 0, 0, DateTimeKind.Utc),
                UpdatedAt = new DateTime(2024, 1, 2, 12, 0, 0, DateTimeKind.Utc),
                Candles =
                [
                    new MarketData
                    {
                        Symbol = "BTCUSDT",
                        Exchange = "ByBit",
                        Interval = "1h",
                        Timestamp = new DateTime(2024, 1, 1, 1, 0, 0, DateTimeKind.Utc),
                        Open = 100m,
                        High = 110m,
                        Low = 90m,
                        Close = 105m,
                        Volume = 12.5m
                    }
                ]
            };

            await repo.SaveAsync(pack);

            var loaded = await repo.GetAsync("ByBit", "BTCUSDT", "1h");

            Assert.NotNull(loaded);
            Assert.Equal("ByBit", loaded.Exchange);
            Assert.Equal("BTCUSDT", loaded.Symbol);
            Assert.Equal("1h", loaded.Interval);
            Assert.True(loaded.Incomplete);
            Assert.Equal(pack.RequestedStart, loaded.RequestedStart);
            Assert.Equal(pack.RequestedEnd, loaded.RequestedEnd);
            Assert.Equal(pack.UpdatedAt, loaded.UpdatedAt);
            Assert.Single(loaded.Candles);
            Assert.Equal(105m, loaded.Candles[0].Close);
            Assert.Equal(12.5m, loaded.Candles[0].Volume);

            var expectedPath = Path.Combine(root, "ByBit", "BTCUSDT_1h.json");
            Assert.True(File.Exists(expectedPath));
            var json = await File.ReadAllTextAsync(expectedPath);
            Assert.Contains("\"incomplete\": true", json, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("\"symbol\": \"BTCUSDT\"", json, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task GetAsync_MissingPack_ReturnsNull()
    {
        var root = CreateTempRoot();
        try
        {
            var repo = CreateRepository(root);
            var loaded = await repo.GetAsync("ByBit", "ETHUSDT", "1h");
            Assert.Null(loaded);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static JsonCandlePackRepository CreateRepository(string root) =>
        new(Options.Create(new CandleStorageOptions { RootPath = root, PackPageSize = 500 }));

    private static string CreateTempRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "TradingTutor-candle-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }
}
