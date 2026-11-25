using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Services;
using Xunit;

namespace TradingTutor.Tests;

public class SessionServiceTests
{
    [Fact]
    public async Task CreateAsync_UpsertsById()
    {
        var fake = new FakeSessionRepository();
        var service = CreateService(fake);
        var session = new TradingSession
        {
            Id = "s1",
            Symbol = "BTCUSDT",
            Interval = "1h",
            StartingBalance = 10_000m
        };

        var created = await service.CreateAsync(session);
        Assert.Equal("s1", created.Id);
        Assert.NotEqual(default, created.CreatedAt);
        Assert.NotEqual(default, created.UpdatedAt);
        Assert.Single(fake.Store);

        session.RealizedPnl = 50m;
        await service.CreateAsync(session);
        Assert.Single(fake.Store);
        Assert.Equal(50m, fake.Store["s1"].RealizedPnl);
    }

    [Fact]
    public async Task CreateAsync_MissingId_Throws()
    {
        var service = CreateService(new FakeSessionRepository());
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreateAsync(new TradingSession { Symbol = "BTCUSDT" }));
    }

    [Fact]
    public async Task GetAsync_Missing_ReturnsNull()
    {
        var service = CreateService(new FakeSessionRepository());
        Assert.Null(await service.GetAsync("missing"));
    }

    [Fact]
    public async Task GetAsync_Existing_ReturnsSession()
    {
        var fake = new FakeSessionRepository();
        fake.Store["s1"] = new TradingSession { Id = "s1", Symbol = "ETHUSDT" };
        var service = CreateService(fake);

        var loaded = await service.GetAsync("s1");
        Assert.NotNull(loaded);
        Assert.Equal("ETHUSDT", loaded.Symbol);
    }

    [Fact]
    public async Task ListAsync_ReturnsNewestFirst()
    {
        var fake = new FakeSessionRepository();
        fake.Store["a"] = new TradingSession
        {
            Id = "a",
            Symbol = "BTCUSDT",
            StartingBalance = 1_000m,
            UpdatedAt = DateTime.UtcNow.AddDays(-1),
            ClosedTrades = [new ClosedTradeInput { Id = "t1" }]
        };
        fake.Store["b"] = new TradingSession
        {
            Id = "b",
            Symbol = "ETHUSDT",
            StartingBalance = 2_000m,
            UpdatedAt = DateTime.UtcNow
        };
        var service = CreateService(fake);

        var list = await service.ListAsync();
        Assert.Equal(2, list.Count);
        Assert.Equal("b", list[0].Id);
        Assert.Equal(0, list[0].ClosedTradeCount);
        Assert.Equal(1, list[1].ClosedTradeCount);
    }

    private static SessionService CreateService(FakeSessionRepository fake) =>
        new(fake, new FakeCandleLoadService([]));

    internal sealed class FakeSessionRepository : ISessionRepository
    {
        public Dictionary<string, TradingSession> Store { get; } = new(StringComparer.Ordinal);

        public Task CreateSessionAsync(
            TradingSession session,
            CancellationToken cancellationToken = default)
        {
            Store[session.Id] = session;
            return Task.CompletedTask;
        }

        public Task<TradingSession?> GetSessionAsync(
            string id,
            CancellationToken cancellationToken = default)
        {
            Store.TryGetValue(id, out var session);
            return Task.FromResult(session);
        }

        public Task<IReadOnlyList<TradingSessionSummary>> ListSessionsAsync(
            CancellationToken cancellationToken = default)
        {
            IReadOnlyList<TradingSessionSummary> list = Store.Values
                .OrderByDescending(s => s.UpdatedAt)
                .Select(s => new TradingSessionSummary
                {
                    Id = s.Id,
                    CreatedAt = s.CreatedAt,
                    UpdatedAt = s.UpdatedAt,
                    Symbol = s.Symbol,
                    ClosedTradeCount = s.ClosedTrades?.Count ?? 0,
                    StartingBalance = s.StartingBalance
                })
                .ToList();
            return Task.FromResult(list);
        }
    }

    internal sealed class FakeCandleLoadService : ICandleLoadService
    {
        private readonly IReadOnlyList<MarketData> _default;
        private readonly IReadOnlyDictionary<string, IReadOnlyList<MarketData>> _byInterval;

        public FakeCandleLoadService(IReadOnlyList<MarketData> candles)
            : this(candles, new Dictionary<string, IReadOnlyList<MarketData>>(StringComparer.OrdinalIgnoreCase))
        {
        }

        public FakeCandleLoadService(
            IReadOnlyList<MarketData> defaultCandles,
            IReadOnlyDictionary<string, IReadOnlyList<MarketData>> byInterval)
        {
            _default = defaultCandles;
            _byInterval = byInterval;
        }

        public Task<CandleLoadResult> LoadAsync(
            string symbol,
            string interval,
            DateTime start,
            DateTime end,
            bool refresh = false,
            int? offset = null,
            int? limit = null,
            CancellationToken cancellationToken = default)
        {
            var candles = _byInterval.TryGetValue(interval, out var specific)
                ? specific
                : _default;
            var list = candles as IReadOnlyList<MarketData> ?? candles.ToList();
            var total = list.Count;
            if (offset is not null || limit is not null)
            {
                var startIdx = Math.Clamp(offset ?? 0, 0, total);
                var take = Math.Max(1, limit ?? 500);
                list = list.Skip(startIdx).Take(take).ToList();
                return Task.FromResult(new CandleLoadResult
                {
                    Candles = list,
                    Source = "local",
                    Incomplete = false,
                    Offset = startIdx,
                    TotalCount = total,
                    HasMore = startIdx + list.Count < total
                });
            }

            return Task.FromResult(new CandleLoadResult
            {
                Candles = list,
                Source = "local",
                Incomplete = false,
                Offset = 0,
                TotalCount = total,
                HasMore = false
            });
        }
    }
}
