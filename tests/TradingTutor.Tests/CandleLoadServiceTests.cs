using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;
using TradingTutor.Trading.Services;
using TradingTutor.Trading.Storage;
using Xunit;

namespace TradingTutor.Tests;

public class CandleLoadServiceTests
{
    [Fact]
    public async Task LoadAsync_LocalCoverHit_DoesNotCallExchange()
    {
        var start = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2024, 1, 1, 3, 0, 0, DateTimeKind.Utc);
        var pack = Pack(
            candles:
            [
                Candle(start, 100m),
                Candle(start.AddHours(1), 101m),
                Candle(start.AddHours(2), 102m),
                Candle(end, 103m)
            ],
            incomplete: false);

        var exchange = new ScriptedExchange();
        var repo = new InMemoryPackRepository(pack);
        var service = CreateService(exchange, repo);

        var result = await service.LoadAsync("BTCUSDT", "1h", start, end, refresh: false);

        Assert.Equal("local", result.Source);
        Assert.False(result.Incomplete);
        Assert.Equal(4, result.Candles.Count);
        Assert.Equal(0, exchange.CallCount);
    }

    [Fact]
    public async Task LoadAsync_Refresh_ForcesExchangeFetchAndUpdatesPack()
    {
        var start = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2024, 1, 1, 2, 0, 0, DateTimeKind.Utc);
        var existing = Pack(
            candles:
            [
                Candle(start, 100m),
                Candle(end, 101m)
            ],
            incomplete: false,
            updatedAt: new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc));

        var exchange = new ScriptedExchange();
        exchange.EnqueuePage(
        [
            Candle(start, 200m),
            Candle(start.AddHours(1), 201m),
            Candle(end, 202m)
        ]);

        var repo = new InMemoryPackRepository(existing);
        var service = CreateService(exchange, repo);

        var result = await service.LoadAsync("BTCUSDT", "1h", start, end, refresh: true);

        Assert.Equal("exchange", result.Source);
        Assert.Equal(3, result.Candles.Count);
        Assert.Equal(200m, result.Candles[0].Close);
        Assert.Equal(1, exchange.CallCount);
        Assert.NotNull(repo.LastSaved);
        Assert.True(repo.LastSaved!.UpdatedAt > existing.UpdatedAt);
        Assert.False(repo.LastSaved.Incomplete);
    }

    [Fact]
    public async Task LoadAsync_MultiPage_AssemblesOldestFirst()
    {
        var start = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        // Wide enough that two full 1000-bar pages are needed before covering start.
        var end = start.AddHours(CandleLoadService.PageSize + 50);

        var newerPage = Enumerable.Range(0, CandleLoadService.PageSize)
            .Select(i => Candle(end.AddHours(-(CandleLoadService.PageSize - 1 - i)), 200m))
            .ToList();
        var olderPage = Enumerable.Range(0, 50)
            .Select(i => Candle(start.AddHours(i), 100m))
            .ToList();

        var exchange = new ScriptedExchange();
        exchange.EnqueuePage(newerPage);
        exchange.EnqueuePage(olderPage);

        var repo = new InMemoryPackRepository();
        var service = CreateService(exchange, repo, maxBars: 10_000);

        var result = await service.LoadAsync("BTCUSDT", "1h", start, end, refresh: false);

        Assert.Equal("exchange", result.Source);
        Assert.Equal(2, exchange.CallCount);
        Assert.True(result.Candles.Count > CandleLoadService.PageSize);
        Assert.True(result.Candles[0].Timestamp <= result.Candles[^1].Timestamp);
        Assert.NotNull(repo.LastSaved);
    }

    [Fact]
    public async Task LoadAsync_SafetyMax_StopsAndMarksIncomplete()
    {
        var start = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2024, 1, 10, 0, 0, 0, DateTimeKind.Utc);

        // MaxBarsPerLoad=5 clamps the window, then a full page of 5 hits the safety stop.
        var exchange = new ScriptedExchange();
        var page = Enumerable.Range(0, 5)
            .Select(i => Candle(end.AddHours(-(4 - i)), 100m + i))
            .ToList();
        exchange.EnqueuePage(page);
        exchange.EnqueuePage(
            Enumerable.Range(0, 5)
                .Select(i => Candle(end.AddHours(-(9 - i)), 90m + i))
                .ToList());

        var repo = new InMemoryPackRepository();
        var service = CreateService(exchange, repo, maxBars: 5);

        var result = await service.LoadAsync("BTCUSDT", "1h", start, end, refresh: false);

        Assert.True(result.Candles.Count <= 5);
        Assert.NotNull(repo.LastSaved);
        Assert.True(result.Incomplete || result.Candles.Count == 5);
    }

    [Fact]
    public async Task LoadAsync_PartialFailure_SavesIncompleteAndReturnsPartial()
    {
        var start = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = start.AddHours(CandleLoadService.PageSize + 10);

        // Full first page so orchestrator continues paging, then fail.
        var firstPage = Enumerable.Range(0, CandleLoadService.PageSize)
            .Select(i => Candle(end.AddHours(-(CandleLoadService.PageSize - 1 - i)), 100m + i))
            .ToList();

        var exchange = new ScriptedExchange();
        exchange.EnqueuePage(firstPage);
        exchange.EnqueueFailure(new InvalidOperationException("boom"));

        var repo = new InMemoryPackRepository();
        var service = CreateService(exchange, repo);

        var result = await service.LoadAsync("BTCUSDT", "1h", start, end, refresh: false);

        Assert.Equal("partial", result.Source);
        Assert.True(result.Incomplete);
        Assert.Equal(CandleLoadService.PageSize, result.Candles.Count);
        Assert.NotNull(repo.LastSaved);
        Assert.True(repo.LastSaved!.Incomplete);
    }

    [Fact]
    public async Task LoadAsync_TotalFailureWithZeroBars_LeavesPriorPackUntouched()
    {
        var start = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2024, 1, 1, 2, 0, 0, DateTimeKind.Utc);
        // Prior pack exists but does NOT cover the requested range.
        var prior = Pack(
            candles: [Candle(start.AddDays(-2), 50m)],
            incomplete: false,
            updatedAt: new DateTime(2023, 12, 1, 0, 0, 0, DateTimeKind.Utc));

        var exchange = new ScriptedExchange();
        exchange.EnqueueFailure(new HttpRequestException("network down"));

        var repo = new InMemoryPackRepository(prior);
        var service = CreateService(exchange, repo);

        await Assert.ThrowsAsync<CandleLoadExchangeException>(() =>
            service.LoadAsync("BTCUSDT", "1h", start, end, refresh: false));

        Assert.Null(repo.LastSaved);
        Assert.Same(prior, repo.Current);
    }

    private static CandleLoadService CreateService(
        IExchangeService exchange,
        ICandlePackRepository repository,
        int maxBars = 10_000) =>
        new(
            exchange,
            repository,
            Options.Create(new CandleStorageOptions
            {
                RootPath = "unused",
                MaxBarsPerLoad = maxBars
            }),
            NullLogger<CandleLoadService>.Instance);

    private static CandlePack Pack(
        IReadOnlyList<MarketData> candles,
        bool incomplete,
        DateTime? updatedAt = null) =>
        new()
        {
            Exchange = "ByBit",
            Symbol = "BTCUSDT",
            Interval = "1h",
            Incomplete = incomplete,
            UpdatedAt = updatedAt ?? DateTime.UtcNow,
            Candles = candles.ToList()
        };

    private static MarketData Candle(DateTime timestamp, decimal close) =>
        new()
        {
            Symbol = "BTCUSDT",
            Exchange = "ByBit",
            Interval = "1h",
            Timestamp = timestamp,
            Open = close,
            High = close,
            Low = close,
            Close = close,
            Volume = 1m
        };

    private sealed class InMemoryPackRepository : ICandlePackRepository
    {
        public CandlePack? Current { get; private set; }
        public CandlePack? LastSaved { get; private set; }

        public InMemoryPackRepository(CandlePack? seed = null)
        {
            Current = seed;
        }

        public Task<CandlePack?> GetAsync(
            string exchange,
            string symbol,
            string interval,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Current);

        public Task SaveAsync(CandlePack pack, CancellationToken cancellationToken = default)
        {
            LastSaved = pack;
            Current = pack;
            return Task.CompletedTask;
        }
    }

    private sealed class ScriptedExchange : IExchangeService
    {
        private readonly Queue<object> _script = new();

        public string ExchangeName => "ByBit";
        public int CallCount { get; private set; }

        public void EnqueuePage(IReadOnlyList<MarketData> page) => _script.Enqueue(page);

        public void EnqueueFailure(Exception ex) => _script.Enqueue(ex);

        public Task<IReadOnlyList<MarketData>> GetMarketDataAsync(
            string symbol,
            string interval,
            DateTime? startTime = null,
            DateTime? endTime = null,
            int limit = 200,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            if (_script.Count == 0)
            {
                return Task.FromResult<IReadOnlyList<MarketData>>([]);
            }

            var next = _script.Dequeue();
            if (next is Exception ex)
            {
                throw ex;
            }

            var page = (IReadOnlyList<MarketData>)next;
            // Truncate to requested limit like a real exchange would.
            if (page.Count > limit)
            {
                page = page.TakeLast(limit).ToList();
            }

            return Task.FromResult(page);
        }
    }
}
