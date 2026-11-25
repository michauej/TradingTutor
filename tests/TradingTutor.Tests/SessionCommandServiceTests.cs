using TradingTutor.Core.Models;
using TradingTutor.Trading.Services;
using Xunit;
using static TradingTutor.Tests.SessionServiceTests;

namespace TradingTutor.Tests;

public class SessionCommandServiceTests
{
    private static readonly DateTime T0 = new(2024, 6, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime T1 = new(2024, 6, 1, 1, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime T2 = new(2024, 6, 1, 2, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime T3 = new(2024, 6, 1, 3, 0, 0, DateTimeKind.Utc);

    private static IReadOnlyList<MarketData> FixtureCandles() =>
    [
        Candle(T0, 100m, 101m, 99m, 100m),
        Candle(T1, 100m, 105m, 95m, 102m),
        Candle(T2, 102m, 110m, 100m, 108m),
        Candle(T3, 108m, 112m, 90m, 95m)
    ];

    private static MarketData Candle(
        DateTime ts,
        decimal open,
        decimal high,
        decimal low,
        decimal close) =>
        new()
        {
            Symbol = "BTCUSDT",
            Exchange = "ByBit",
            Interval = "1h",
            Timestamp = ts,
            Open = open,
            High = high,
            Low = low,
            Close = close,
            Volume = 1m
        };

    private static (SessionService Service, FakeSessionRepository Repo) Create()
    {
        var repo = new FakeSessionRepository();
        var service = new SessionService(repo, new FakeCandleLoadService(FixtureCandles()));
        return (service, repo);
    }

    private static async Task<TradingSession> StartLockedAtPlayheadAsync(
        SessionService service,
        int playhead = 1)
    {
        var started = await service.StartAsync(new StartSessionRequest
        {
            Symbol = "BTCUSDT",
            Interval = "1h",
            RangeStart = T0,
            RangeEnd = T3.AddHours(1),
            SessionStartDate = "2024-06-01",
            StartingBalance = 10_000m,
            Playhead = playhead
        });
        return await service.LockAsync(started.Id);
    }

    [Fact]
    public async Task StartAsync_AssignsIdAndEmptyTradingState()
    {
        var (service, repo) = Create();
        var session = await service.StartAsync(new StartSessionRequest
        {
            Symbol = "btcusdt",
            Interval = "1h",
            RangeStart = T0,
            RangeEnd = T3,
            SessionStartDate = "2024-06-01",
            StartingBalance = 10_000m,
            Playhead = 1
        });

        Assert.False(string.IsNullOrWhiteSpace(session.Id));
        Assert.Equal("BTCUSDT", session.Symbol);
        Assert.Empty(session.Lots);
        Assert.Empty(session.PendingOrders);
        Assert.Empty(session.ClosedTrades);
        Assert.Equal(0m, session.RealizedPnl);
        Assert.True(session.SessionLocked);
        Assert.True(repo.Store.ContainsKey(session.Id));
    }

    [Fact]
    public async Task OpenAsync_PersistsLotAtMarkClose()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);

        var opened = await service.OpenAsync(locked.Id, new OpenSessionRequest
        {
            Side = "long",
            Qty = 1m
        });

        var lot = Assert.Single(opened.Lots);
        Assert.Equal("long", lot.Side);
        Assert.Equal(1m, lot.Qty);
        Assert.Equal(100m, lot.EntryPrice); // mark = candles[0].Close
        Assert.Equal(T0, lot.EntryTime);
    }

    [Fact]
    public async Task OpenAsync_SoftCapExceeded_Throws()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);

        var ex = await Assert.ThrowsAsync<SessionCommandException>(() =>
            service.OpenAsync(locked.Id, new OpenSessionRequest
            {
                Side = "long",
                Qty = 200m // 200 * 100 = 20_000 > 10_000
            }));
        Assert.Contains("exceeds balance", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CloseAsync_Fifo_PersistsClosedTradeAndPnl()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);
        await service.OpenAsync(locked.Id, new OpenSessionRequest { Side = "long", Qty = 1m });

        // Advance to playhead 2 so mark is 102
        await service.AdvanceAsync(locked.Id, new AdvanceSessionRequest { ToPlayhead = 2 });
        var closed = await service.CloseAsync(locked.Id, new CloseSessionRequest
        {
            Mode = "fifo",
            Side = "long"
        });

        Assert.Empty(closed.Lots);
        var trade = Assert.Single(closed.ClosedTrades);
        Assert.Equal(100m, trade.EntryPrice);
        Assert.Equal(102m, trade.ExitPrice);
        Assert.Equal(2m, trade.RealizedPnl);
        Assert.Equal(2m, closed.RealizedPnl);
    }

    [Fact]
    public async Task AdvanceAsync_MatchesLimitAndUpdatesPlayhead()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);

        await service.PlaceOrderAsync(locked.Id, new PlaceOrderRequest
        {
            Side = "long",
            Intent = "open",
            Type = "limit",
            Qty = 1m,
            LimitPrice = 95m
        });

        // Bar at index 1 (playhead 2) has low 95 — fills open long limit
        var advanced = await service.AdvanceAsync(
            locked.Id,
            new AdvanceSessionRequest { ToPlayhead = 2 });

        Assert.Equal(2, advanced.Playhead);
        Assert.True(advanced.SessionLocked);
        Assert.Empty(advanced.PendingOrders);
        var lot = Assert.Single(advanced.Lots);
        Assert.Equal(95m, lot.EntryPrice);
        Assert.Equal(T1, lot.EntryTime);
    }

    [Fact]
    public async Task AdvanceAsync_UsesPackOhlcAndIgnoresClientBars()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);

        await service.PlaceOrderAsync(locked.Id, new PlaceOrderRequest
        {
            Side = "long",
            Intent = "open",
            Type = "limit",
            Qty = 1m,
            LimitPrice = 95m
        });

        // Forged client bars would not touch 95; pack bar at T1 has Low=95 and must fill.
        var advanced = await service.AdvanceAsync(locked.Id, new AdvanceSessionRequest
        {
            ToPlayhead = 2,
            Bars =
            [
                new AdvanceBarDto
                {
                    Open = 200m,
                    High = 201m,
                    Low = 199m,
                    Close = 200m,
                    Timestamp = T1
                }
            ]
        });

        Assert.Equal(2, advanced.Playhead);
        Assert.Empty(advanced.PendingOrders);
        var lot = Assert.Single(advanced.Lots);
        Assert.Equal(95m, lot.EntryPrice);
    }

    [Fact]
    public async Task OpenAsync_IgnoresForgedClientMark_UsesPackClose()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);

        var opened = await service.OpenAsync(locked.Id, new OpenSessionRequest
        {
            Side = "long",
            Qty = 1m,
            MarkPrice = 999m,
            MarkTime = T3
        });

        var lot = Assert.Single(opened.Lots);
        Assert.Equal(100m, lot.EntryPrice);
        Assert.Equal(T0, lot.EntryTime);
    }

    [Fact]
    public async Task AdvanceAsync_MissingSession_ThrowsNotFound()
    {
        var (service, _) = Create();
        await Assert.ThrowsAsync<SessionNotFoundException>(() =>
            service.AdvanceAsync("missing", new AdvanceSessionRequest { ToPlayhead = 2 }));
    }

    [Fact]
    public async Task CancelOrderAsync_RemovesRestingOrder()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);
        var withOrder = await service.PlaceOrderAsync(locked.Id, new PlaceOrderRequest
        {
            Side = "long",
            Intent = "open",
            Type = "limit",
            Qty = 1m,
            LimitPrice = 90m
        });
        var orderId = Assert.Single(withOrder.PendingOrders).Id;

        var cancelled = await service.CancelOrderAsync(locked.Id, orderId);
        Assert.Empty(cancelled.PendingOrders);
    }

    [Fact]
    public async Task AdvanceAsync_ToPlayheadBeyondCandles_Throws()
    {
        var (service, _) = Create();
        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);

        var ex = await Assert.ThrowsAsync<SessionCommandException>(() =>
            service.AdvanceAsync(locked.Id, new AdvanceSessionRequest { ToPlayhead = 99 }));
        Assert.Contains("exceeds candle count", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ReanchorIntervalAsync_KeepsOrdersAndRemapsPlayheadByWatermark()
    {
        var hourly = FixtureCandles();
        // 15m series covering the same wall span; tip at T1 (01:00) falls inside 1h bar T1.
        var m15 = new List<MarketData>
        {
            Candle(T0, 100m, 101m, 99m, 100m),
            Candle(T0.AddMinutes(15), 100m, 102m, 99m, 101m),
            Candle(T0.AddMinutes(30), 101m, 103m, 100m, 102m),
            Candle(T0.AddMinutes(45), 102m, 104m, 101m, 103m),
            Candle(T1, 103m, 105m, 95m, 102m),
            Candle(T1.AddMinutes(15), 102m, 106m, 101m, 104m),
        };
        foreach (var c in m15)
        {
            c.Interval = "15m";
        }

        var repo = new FakeSessionRepository();
        var candles = new FakeCandleLoadService(
            hourly,
            new Dictionary<string, IReadOnlyList<MarketData>>(StringComparer.OrdinalIgnoreCase)
            {
                ["1h"] = hourly,
                ["15m"] = m15
            });
        var service = new SessionService(repo, candles);

        var locked = await StartLockedAtPlayheadAsync(service, playhead: 1);
        await service.PlaceOrderAsync(locked.Id, new PlaceOrderRequest
        {
            Side = "long",
            Intent = "open",
            Type = "limit",
            Qty = 1m,
            LimitPrice = 90m
        });
        // Advance to playhead 2 → watermark = T1, mark = 102
        await service.AdvanceAsync(locked.Id, new AdvanceSessionRequest { ToPlayhead = 2 });

        var reanchored = await service.ReanchorIntervalAsync(
            locked.Id,
            new ReanchorIntervalRequest { Interval = "15m" });

        Assert.Equal("15m", reanchored.Interval);
        Assert.Equal(T1, reanchored.SimWatermark);
        Assert.Equal(102m, reanchored.SimMarkPrice);
        Assert.Single(reanchored.PendingOrders);
        // Watermark T1 equals a 15m open → that bar is revealed (playhead 5).
        Assert.Equal(5, reanchored.Playhead);

        // Back to 1h: T1 equals hourly open → reveal through that bar; orders kept.
        var back = await service.ReanchorIntervalAsync(
            locked.Id,
            new ReanchorIntervalRequest { Interval = "1h" });
        Assert.Equal("1h", back.Interval);
        Assert.Equal(2, back.Playhead);
        Assert.Equal(T1, back.SimWatermark);
        Assert.Single(back.PendingOrders);
    }

    [Fact]
    public void PlayheadForWatermark_InsideFormingBar_IncludesFormingBar()
    {
        var hourly = FixtureCandles();
        // Tip 01:30 falls inside the T1 (01:00) hourly bar → reveal through T1.
        var tip = T1.AddMinutes(30);
        var playhead = SessionService.PlayheadForWatermark(hourly, tip, "1h");
        Assert.Equal(2, playhead); // T0 + T1
    }

}
