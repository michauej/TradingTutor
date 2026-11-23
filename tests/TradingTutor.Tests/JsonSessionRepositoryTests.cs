using Microsoft.Extensions.Options;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Options;
using TradingTutor.Trading.Storage;
using Xunit;

namespace TradingTutor.Tests;

public class JsonSessionRepositoryTests
{
    [Fact]
    public async Task CreateAndGet_RoundTripsSession()
    {
        var root = CreateTempRoot();
        try
        {
            var repo = CreateRepository(root);
            var session = SampleSession("sess-1");

            await repo.CreateSessionAsync(session);
            var loaded = await repo.GetSessionAsync("sess-1");

            Assert.NotNull(loaded);
            Assert.Equal(session.Id, loaded.Id);
            Assert.Equal(session.Symbol, loaded.Symbol);
            Assert.Equal(session.Exchange, loaded.Exchange);
            Assert.Equal(session.Interval, loaded.Interval);
            Assert.Equal(session.StartingBalance, loaded.StartingBalance);
            Assert.Equal(session.RealizedPnl, loaded.RealizedPnl);
            Assert.Equal(session.Playhead, loaded.Playhead);
            Assert.True(loaded.SessionLocked);
            Assert.Single(loaded.Lots);
            Assert.Equal("lot-1", loaded.Lots[0].Id);
            Assert.Single(loaded.PendingOrders);
            Assert.Single(loaded.ClosedTrades);
            Assert.Equal(12.5m, loaded.ClosedTrades[0].RealizedPnl);

            var expectedPath = Path.Combine(root, "sess-1.json");
            Assert.True(File.Exists(expectedPath));
            var json = await File.ReadAllTextAsync(expectedPath);
            Assert.Contains("\"symbol\": \"BTCUSDT\"", json, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("\"sessionLocked\": true", json, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task CreateSession_SameId_Overwrites()
    {
        var root = CreateTempRoot();
        try
        {
            var repo = CreateRepository(root);
            var first = SampleSession("sess-ow");
            first.RealizedPnl = 1m;
            await repo.CreateSessionAsync(first);

            var second = SampleSession("sess-ow");
            second.RealizedPnl = 99m;
            second.UpdatedAt = first.UpdatedAt.AddHours(1);
            second.ClosedTrades =
            [
                new ClosedTradeInput
                {
                    Id = "t2",
                    Side = "long",
                    Qty = 1m,
                    EntryPrice = 100m,
                    EntryTime = DateTime.UtcNow.AddHours(-2),
                    ExitPrice = 110m,
                    ExitTime = DateTime.UtcNow.AddHours(-1),
                    RealizedPnl = 10m
                },
                new ClosedTradeInput
                {
                    Id = "t3",
                    Side = "short",
                    Qty = 1m,
                    EntryPrice = 110m,
                    EntryTime = DateTime.UtcNow.AddHours(-1),
                    ExitPrice = 100m,
                    ExitTime = DateTime.UtcNow,
                    RealizedPnl = 10m
                }
            ];
            await repo.CreateSessionAsync(second);

            var loaded = await repo.GetSessionAsync("sess-ow");
            Assert.NotNull(loaded);
            Assert.Equal(99m, loaded.RealizedPnl);
            Assert.Equal(2, loaded.ClosedTrades.Count);

            var list = await repo.ListSessionsAsync();
            Assert.Single(list);
            Assert.Equal(2, list[0].ClosedTradeCount);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ListSessions_ReturnsSummariesNewestFirst()
    {
        var root = CreateTempRoot();
        try
        {
            var repo = CreateRepository(root);
            var older = SampleSession("a");
            older.UpdatedAt = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            var newer = SampleSession("b");
            newer.Symbol = "ETHUSDT";
            newer.UpdatedAt = new DateTime(2024, 6, 1, 0, 0, 0, DateTimeKind.Utc);

            await repo.CreateSessionAsync(older);
            await repo.CreateSessionAsync(newer);

            var list = await repo.ListSessionsAsync();
            Assert.Equal(2, list.Count);
            Assert.Equal("b", list[0].Id);
            Assert.Equal("ETHUSDT", list[0].Symbol);
            Assert.Equal("a", list[1].Id);
            Assert.Equal(10_000m, list[0].StartingBalance);
            Assert.Equal(1, list[0].ClosedTradeCount);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task GetSession_MissingId_ReturnsNull()
    {
        var root = CreateTempRoot();
        try
        {
            var repo = CreateRepository(root);
            var loaded = await repo.GetSessionAsync("does-not-exist");
            Assert.Null(loaded);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static JsonSessionRepository CreateRepository(string root) =>
        new(Options.Create(new SessionStorageOptions { RootPath = root }));

    private static string CreateTempRoot()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "TradingTutor-session-tests",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static TradingSession SampleSession(string id) =>
        new()
        {
            Id = id,
            CreatedAt = new DateTime(2024, 3, 1, 10, 0, 0, DateTimeKind.Utc),
            UpdatedAt = new DateTime(2024, 3, 1, 12, 0, 0, DateTimeKind.Utc),
            Symbol = "BTCUSDT",
            Exchange = "ByBit",
            Interval = "1h",
            RangeStart = new DateTime(2024, 2, 1, 0, 0, 0, DateTimeKind.Utc),
            RangeEnd = new DateTime(2024, 3, 1, 0, 0, 0, DateTimeKind.Utc),
            SessionStartDate = "2024-02-15",
            Playhead = 42,
            SessionLocked = true,
            StartingBalance = 10_000m,
            RealizedPnl = 12.5m,
            Lots =
            [
                new SessionLot
                {
                    Id = "lot-1",
                    Side = "long",
                    Qty = 0.01m,
                    EntryPrice = 50_000m,
                    EntryTime = new DateTime(2024, 2, 20, 8, 0, 0, DateTimeKind.Utc)
                }
            ],
            PendingOrders =
            [
                new SessionOrder
                {
                    Id = "ord-1",
                    Side = "long",
                    Intent = "close",
                    Type = "limit",
                    Qty = 0.01m,
                    LimitPrice = 55_000m,
                    CreatedAt = new DateTime(2024, 2, 20, 9, 0, 0, DateTimeKind.Utc)
                }
            ],
            ClosedTrades =
            [
                new ClosedTradeInput
                {
                    Id = "t1",
                    Side = "short",
                    Qty = 0.02m,
                    EntryPrice = 51_000m,
                    EntryTime = new DateTime(2024, 2, 18, 10, 0, 0, DateTimeKind.Utc),
                    ExitPrice = 50_375m,
                    ExitTime = new DateTime(2024, 2, 19, 10, 0, 0, DateTimeKind.Utc),
                    RealizedPnl = 12.5m
                }
            ]
        };
}
