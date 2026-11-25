using TradingTutor.Core.Models;
using TradingTutor.Trading.Services;
using Xunit;

namespace TradingTutor.Tests;

/// <summary>Parity with <c>frontend/src/trading/trading.test.ts</c>.</summary>
public class PaperTradingEngineTests
{
    private static readonly DateTime T0 = DateTime.Parse("2024-06-01T00:00:00.000Z").ToUniversalTime();
    private static readonly DateTime T1 = DateTime.Parse("2024-06-01T01:00:00.000Z").ToUniversalTime();

    private readonly PaperTradingEngine _engine = new();

    public PaperTradingEngineTests()
    {
        _engine.ResetIdSeq();
    }

    private static OhlcBar Bar(
        decimal low,
        decimal high,
        decimal? open = null,
        decimal? close = null,
        DateTime? timestamp = null) =>
        new()
        {
            Open = open ?? low,
            Close = close ?? high,
            Low = low,
            High = high,
            Timestamp = timestamp ?? T1
        };

    private static SessionOrder LimitOrder(
        string side,
        string intent,
        decimal qty,
        decimal limitPrice,
        string? id = null,
        DateTime? createdAt = null) =>
        new()
        {
            Id = id ?? $"ord-{side}-{intent}",
            Type = "limit",
            CreatedAt = createdAt ?? T0,
            Side = side,
            Intent = intent,
            Qty = qty,
            LimitPrice = limitPrice
        };

    private static SessionLot Lot(
        string id,
        string side,
        decimal qty,
        decimal entryPrice,
        DateTime? entryTime = null) =>
        new()
        {
            Id = id,
            Side = side,
            Qty = qty,
            EntryPrice = entryPrice,
            EntryTime = entryTime ?? T0
        };

    // --- qtyFromPercent + soft cap ---

    [Fact]
    public void QtyFromPercent_ConvertsPercentOfWalletIntoQtyAtMark()
    {
        var result = PaperTradingEngine.QtyFromPercent(10_000m, 10m, 100m);
        var accept = Assert.IsType<SizingResult.Accept>(result);
        Assert.Equal(10m, accept.Qty);
    }

    [Fact]
    public void QtyFromPercent_RejectsNonPositivePercentMarkOrBalance()
    {
        Assert.IsType<SizingResult.Reject>(PaperTradingEngine.QtyFromPercent(10_000m, 0m, 100m));
        Assert.IsType<SizingResult.Reject>(PaperTradingEngine.QtyFromPercent(10_000m, 10m, 0m));
        Assert.IsType<SizingResult.Reject>(PaperTradingEngine.QtyFromPercent(0m, 10m, 100m));
    }

    [Fact]
    public void ValidateQtyAgainstSoftCap_RejectsWhenNotionalExceedsBalance()
    {
        var result = PaperTradingEngine.ValidateQtyAgainstSoftCap(2m, 10_000m, 10_000m);
        var reject = Assert.IsType<SizingResult.Reject>(result);
        Assert.Equal("softCapExceeded", reject.Reason);
    }

    [Fact]
    public void ValidateQtyAgainstSoftCap_AcceptsOnSoftCapBoundary()
    {
        var result = PaperTradingEngine.ValidateQtyAgainstSoftCap(1m, 10_000m, 10_000m);
        var accept = Assert.IsType<SizingResult.Accept>(result);
        Assert.Equal(1m, accept.Qty);
    }

    // --- market open pyramid + hedge ---

    [Fact]
    public void OpenMarket_PyramidsTwoLongsAndReportsNetAvgEntry()
    {
        var first = _engine.OpenMarket(
            [],
            "long",
            1m,
            100m,
            DateTime.Parse("2024-01-01T00:00:01Z").ToUniversalTime(),
            10_000m,
            id: "l1");
        var firstOk = Assert.IsType<OpenMarketResult.Success>(first);

        var second = _engine.OpenMarket(
            firstOk.Lots,
            "long",
            1m,
            120m,
            DateTime.Parse("2024-01-01T00:00:02Z").ToUniversalTime(),
            10_000m,
            id: "l2");
        var secondOk = Assert.IsType<OpenMarketResult.Success>(second);

        Assert.Equal(2, secondOk.Lots.Count);
        var (longNet, shortNet) = PaperTradingEngine.NetSides(secondOk.Lots);
        Assert.Equal(2m, longNet.Qty);
        Assert.Equal(110m, longNet.AvgEntry);
        Assert.Equal(0m, shortNet.Qty);
        Assert.Equal(0m, shortNet.AvgEntry);
    }

    [Fact]
    public void OpenMarket_AllowsConcurrentLongAndShortHedge()
    {
        var longOpen = _engine.OpenMarket(
            [],
            "long",
            1m,
            100m,
            DateTime.Parse("2024-01-01T00:00:01Z").ToUniversalTime(),
            10_000m,
            id: "l1");
        var longOk = Assert.IsType<OpenMarketResult.Success>(longOpen);

        var shortOpen = _engine.OpenMarket(
            longOk.Lots,
            "short",
            2m,
            110m,
            DateTime.Parse("2024-01-01T00:00:02Z").ToUniversalTime(),
            10_000m,
            id: "s1");
        var shortOk = Assert.IsType<OpenMarketResult.Success>(shortOpen);

        var (longNet, shortNet) = PaperTradingEngine.NetSides(shortOk.Lots);
        Assert.Equal(1m, longNet.Qty);
        Assert.Equal(100m, longNet.AvgEntry);
        Assert.Equal(2m, shortNet.Qty);
        Assert.Equal(110m, shortNet.AvgEntry);
    }

    // --- FIFO close + close-all ---

    private static IReadOnlyList<SessionLot> FifoFixtureLots() =>
    [
        Lot("a", "long", 1m, 100m, DateTime.Parse("2024-01-01T00:00:01Z").ToUniversalTime()),
        Lot("b", "long", 1m, 120m, DateTime.Parse("2024-01-01T00:00:02Z").ToUniversalTime()),
        Lot("c", "short", 1m, 130m, DateTime.Parse("2024-01-01T00:00:03Z").ToUniversalTime())
    ];

    [Fact]
    public void CloseMarketFifo_ClosesOldestLotOnChosenSideFirst()
    {
        var exit = DateTime.Parse("2024-01-01T00:01:00Z").ToUniversalTime();
        var result = _engine.CloseMarketFifo(FifoFixtureLots(), "long", 150m, exit, tradeId: "tr1");
        var ok = Assert.IsType<CloseMarketResult.Success>(result);

        Assert.Equal("tr1", ok.ClosedTrade.Id);
        Assert.Equal("long", ok.ClosedTrade.Side);
        Assert.Equal(1m, ok.ClosedTrade.Qty);
        Assert.Equal(100m, ok.ClosedTrade.EntryPrice);
        Assert.Equal(150m, ok.ClosedTrade.ExitPrice);
        Assert.Equal(50m, ok.ClosedTrade.RealizedPnl);
        Assert.Equal(["b", "c"], ok.Lots.Select(l => l.Id).ToArray());
    }

    [Fact]
    public void CloseAll_FlattensBothSides()
    {
        var exit = DateTime.Parse("2024-01-01T00:01:00Z").ToUniversalTime();
        var n = 0;
        var result = _engine.CloseAll(
            FifoFixtureLots(),
            110m,
            exit,
            idFactory: () => $"t{++n}");

        Assert.Empty(result.Lots);
        Assert.Equal(3, result.ClosedTrades.Count);
        // long 100→110 = +10; long 120→110 = -10; short 130→110 = +20
        Assert.Equal(20m, result.RealizedPnl);
    }

    [Fact]
    public void CloseMarketFifo_ReportsFlatWhenNoLotsOnSide()
    {
        var longsOnly = FifoFixtureLots().Where(l => l.Side == "long").ToList();
        var result = _engine.CloseMarketFifo(
            longsOnly,
            "short",
            1m,
            DateTime.UtcNow);
        var fail = Assert.IsType<CloseMarketResult.Failure>(result);
        Assert.Equal("flat", fail.Reason);
    }

    [Fact]
    public void CloseLotById_ClosesSpecificLot()
    {
        var exit = DateTime.Parse("2024-01-01T00:01:00Z").ToUniversalTime();
        var result = _engine.CloseLotById(FifoFixtureLots(), "b", 130m, exit, tradeId: "by-id");
        var ok = Assert.IsType<CloseMarketResult.Success>(result);

        Assert.Equal("by-id", ok.ClosedTrade.Id);
        Assert.Equal("long", ok.ClosedTrade.Side);
        Assert.Equal(120m, ok.ClosedTrade.EntryPrice);
        Assert.Equal(130m, ok.ClosedTrade.ExitPrice);
        Assert.Equal(10m, ok.ClosedTrade.RealizedPnl);
        Assert.Equal(["a", "c"], ok.Lots.Select(l => l.Id).ToArray());
    }

    // --- realized PnL signs ---

    [Fact]
    public void RealizedPnl_IsPositiveForLongUpAndShortDown()
    {
        Assert.Equal(20m, PaperTradingEngine.RealizedPnl("long", 2m, 100m, 110m));
        Assert.Equal(20m, PaperTradingEngine.RealizedPnl("short", 2m, 100m, 90m));
    }

    [Fact]
    public void RealizedPnl_IsNegativeForLongDownAndShortUp()
    {
        Assert.Equal(-10m, PaperTradingEngine.RealizedPnl("long", 1m, 100m, 90m));
        Assert.Equal(-10m, PaperTradingEngine.RealizedPnl("short", 1m, 100m, 110m));
    }

    // --- limit touch matching ---

    [Fact]
    public void MatchLimits_FillsOpenLongWhenBarLowTouchesLimit()
    {
        var orders = new[]
        {
            LimitOrder("long", "open", 1m, 95m, id: "ol")
        };
        var result = _engine.MatchLimits(
            orders,
            [],
            Bar(94m, 101m, open: 100m, close: 99m),
            10_000m,
            idFactory: () => "lot-1");

        Assert.Single(result.Filled);
        var lot = Assert.Single(result.Lots);
        Assert.Equal("lot-1", lot.Id);
        Assert.Equal("long", lot.Side);
        Assert.Equal(1m, lot.Qty);
        Assert.Equal(95m, lot.EntryPrice);
        Assert.Equal(T1, lot.EntryTime);
        Assert.Empty(result.Orders);
    }

    [Fact]
    public void MatchLimits_FillsOpenShortWhenBarHighTouchesLimit()
    {
        var result = _engine.MatchLimits(
            [LimitOrder("short", "open", 1m, 105m, id: "os")],
            [],
            Bar(100m, 105m, close: 104m),
            10_000m,
            idFactory: () => "lot-s");

        Assert.Equal(["os"], result.Filled.Select(o => o.Id).ToArray());
        var lot = Assert.Single(result.Lots);
        Assert.Equal("short", lot.Side);
        Assert.Equal(105m, lot.EntryPrice);
    }

    [Fact]
    public void MatchLimits_DoesNotFillWhenBarDoesNotTouchLimit()
    {
        var orders = new[]
        {
            LimitOrder("long", "open", 1m, 90m, id: "ol")
        };
        var result = _engine.MatchLimits(orders, [], Bar(95m, 100m), 10_000m);

        Assert.Empty(result.Filled);
        Assert.Equal(orders, result.Orders);
        Assert.Empty(result.Lots);
    }

    [Fact]
    public void MatchLimits_FillsCloseLongOnHighAndCloseShortOnLowAtLimit()
    {
        var lots = new[]
        {
            Lot("l1", "long", 1m, 100m),
            Lot("s1", "short", 1m, 100m)
        };
        var n = 0;
        var result = _engine.MatchLimits(
            [
                LimitOrder("long", "close", 1m, 110m, id: "cl"),
                LimitOrder("short", "close", 1m, 90m, id: "cs")
            ],
            lots,
            Bar(90m, 110m),
            10_000m,
            idFactory: () => $"tr-{++n}");

        Assert.Equal(["cl", "cs"], result.Filled.Select(o => o.Id).ToArray());
        Assert.Empty(result.Lots);
        Assert.Equal(2, result.ClosedTrades.Count);
        Assert.Equal("long", result.ClosedTrades[0].Side);
        Assert.Equal(110m, result.ClosedTrades[0].ExitPrice);
        Assert.Equal(10m, result.ClosedTrades[0].RealizedPnl);
        Assert.Equal("short", result.ClosedTrades[1].Side);
        Assert.Equal(90m, result.ClosedTrades[1].ExitPrice);
        Assert.Equal(10m, result.ClosedTrades[1].RealizedPnl);
        Assert.Equal(20m, result.RealizedPnlDelta);
    }

    [Fact]
    public void MatchLimits_FillsStopLossLongOnLowAndShortOnHigh()
    {
        var lots = new[]
        {
            Lot("l1", "long", 1m, 100m),
            Lot("s1", "short", 1m, 100m)
        };
        var n = 0;
        var result = _engine.MatchLimits(
            [
                new SessionOrder
                {
                    Id = "sl-l",
                    Side = "long",
                    Intent = "close",
                    Type = "stop",
                    Qty = 1m,
                    LimitPrice = 90m,
                    CreatedAt = T0
                },
                new SessionOrder
                {
                    Id = "sl-s",
                    Side = "short",
                    Intent = "close",
                    Type = "stop",
                    Qty = 1m,
                    LimitPrice = 110m,
                    CreatedAt = T0
                }
            ],
            lots,
            Bar(90m, 110m),
            10_000m,
            idFactory: () => $"tr-{++n}");

        Assert.Equal(["sl-l", "sl-s"], result.Filled.Select(o => o.Id).ToArray());
        Assert.Empty(result.Lots);
        Assert.Equal("long", result.ClosedTrades[0].Side);
        Assert.Equal(90m, result.ClosedTrades[0].ExitPrice);
        Assert.Equal(-10m, result.ClosedTrades[0].RealizedPnl);
        Assert.Equal("short", result.ClosedTrades[1].Side);
        Assert.Equal(110m, result.ClosedTrades[1].ExitPrice);
        Assert.Equal(-10m, result.ClosedTrades[1].RealizedPnl);
    }

    [Fact]
    public void MatchLimits_LeavesStopLossRestingWhenAdversePriceNotTouched()
    {
        var order = new SessionOrder
        {
            Id = "sl",
            Side = "long",
            Intent = "close",
            Type = "stop",
            Qty = 1m,
            LimitPrice = 90m,
            CreatedAt = T0
        };
        var result = _engine.MatchLimits(
            [order],
            [Lot("l1", "long", 1m, 100m)],
            Bar(95m, 105m),
            10_000m);

        Assert.Empty(result.Filled);
        Assert.Single(result.Orders);
        Assert.Equal("sl", result.Orders[0].Id);
    }

    [Fact]
    public void MatchLimits_CancelsOpenFillWithoutMutatingLotsWhenSoftCapFails()
    {
        var order = LimitOrder("long", "open", 2m, 10_000m, id: "big");
        var result = _engine.MatchLimits(
            [order],
            [],
            Bar(9_000m, 10_000m),
            10_000m);

        Assert.Empty(result.Lots);
        Assert.Empty(result.Filled);
        Assert.Empty(result.Orders);
        var cancelled = Assert.Single(result.Cancelled);
        Assert.Equal("big", cancelled.Order.Id);
        Assert.Equal("softCapExceeded", cancelled.Reason);
    }

    // --- multi-order book + cancel ---

    [Fact]
    public void PlaceLimitAndCancelOrder_KeepsRestingAndCancelsById()
    {
        var orders = PaperTradingEngine.PlaceLimitOrder(
            [],
            LimitOrder("long", "open", 1m, 90m, id: "a"));
        orders = PaperTradingEngine.PlaceLimitOrder(
            orders,
            LimitOrder("short", "open", 1m, 120m, id: "b"));

        Assert.Equal(2, orders.Count);
        var cancelled = PaperTradingEngine.CancelOrder(orders, "a");
        Assert.Equal("a", cancelled.Cancelled?.Id);
        Assert.Equal(["b"], cancelled.Orders.Select(o => o.Id).ToArray());
    }

    // --- accountBalance ---

    [Fact]
    public void AccountBalance_IsStartingPlusRealized()
    {
        Assert.Equal(
            9_750m,
            PaperTradingEngine.AccountBalance(new PaperAccount
            {
                StartingBalance = 10_000m,
                RealizedPnl = -250m
            }));
    }
}
