using TradingTutor.Coaching.Rules;
using TradingTutor.Core.Models;
using Xunit;

namespace TradingTutor.Tests;

public class FixedRulePackTests
{
    private static ClosedTradeInput Trade(
        string id,
        string side,
        decimal entry,
        decimal exit,
        decimal pnl,
        DateTime? entryTime = null,
        DateTime? exitTime = null)
    {
        var open = entryTime ?? new DateTime(2024, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var close = exitTime ?? open.AddMinutes(10);
        return new ClosedTradeInput
        {
            Id = id,
            Side = side,
            Qty = 1m,
            EntryPrice = entry,
            EntryTime = open,
            ExitPrice = exit,
            ExitTime = close,
            RealizedPnl = pnl
        };
    }

    [Fact]
    public void Evaluate_EmptyTrades_ReturnsEmptyFindings()
    {
        var pack = new FixedRulePack();
        Assert.Empty(pack.Evaluate([]));
    }

    [Fact]
    public void Evaluate_LongAdverseHalfPercent_FiresPrdRule()
    {
        // 100 → 99.5 is exactly 0.5% adverse on a long
        var trades = new[]
        {
            Trade("t1", "long", 100m, 99.5m, -0.5m)
        };

        var pack = new FixedRulePack();
        var findings = pack.Evaluate(trades);

        var hit = Assert.Single(findings, f => f.Id == "long-adverse-05");
        Assert.Equal("warning", hit.Severity);
        Assert.Contains("t1", hit.RelatedTradeIds!);
    }

    [Fact]
    public void Evaluate_LongSlightLossBelowThreshold_StaysQuiet()
    {
        // 100 → 99.6 is 0.4% adverse — under 0.5%
        var trades = new[]
        {
            Trade("t1", "long", 100m, 99.6m, -0.4m)
        };

        var pack = new FixedRulePack();
        var findings = pack.Evaluate(trades);

        Assert.DoesNotContain(findings, f => f.Id == "long-adverse-05");
    }

    [Fact]
    public void Evaluate_ShortAdverseHalfPercent_FiresCounterpart()
    {
        var trades = new[]
        {
            Trade("s1", "short", 100m, 100.5m, -0.5m)
        };

        var pack = new FixedRulePack();
        var findings = pack.Evaluate(trades);

        var hit = Assert.Single(findings, f => f.Id == "short-adverse-05");
        Assert.Contains("s1", hit.RelatedTradeIds!);
    }

    [Fact]
    public void Evaluate_ThreeConsecutiveLosses_FiresLossCluster()
    {
        var t0 = new DateTime(2024, 1, 1, 10, 0, 0, DateTimeKind.Utc);
        var trades = new[]
        {
            Trade("a", "long", 100m, 101m, 1m, t0, t0.AddMinutes(1)),
            Trade("b", "long", 100m, 99m, -1m, t0.AddMinutes(2), t0.AddMinutes(3)),
            Trade("c", "long", 100m, 99m, -1m, t0.AddMinutes(4), t0.AddMinutes(5)),
            Trade("d", "long", 100m, 99m, -1m, t0.AddMinutes(6), t0.AddMinutes(7)),
        };

        var pack = new FixedRulePack();
        var findings = pack.Evaluate(trades);

        var hit = Assert.Single(findings, f => f.Id == "loss-cluster-3");
        Assert.Equal(3, hit.RelatedTradeIds!.Count);
        Assert.Equal(["b", "c", "d"], hit.RelatedTradeIds);
    }

    [Fact]
    public void Evaluate_HoldUnder60Seconds_FiresShortHold()
    {
        var open = new DateTime(2024, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var trades = new[]
        {
            Trade("fast", "long", 100m, 101m, 1m, open, open.AddSeconds(30))
        };

        var pack = new FixedRulePack();
        var findings = pack.Evaluate(trades);

        Assert.Contains(findings, f => f.Id == "short-hold-60s");
    }

    [Fact]
    public void Evaluate_LowWinRateOnBatchOfFive_Fires()
    {
        var trades = new[]
        {
            Trade("1", "long", 100m, 101m, 1m),
            Trade("2", "long", 100m, 99m, -1m),
            Trade("3", "long", 100m, 99m, -1m),
            Trade("4", "long", 100m, 99m, -1m),
            Trade("5", "long", 100m, 99m, -1m),
        };

        var pack = new FixedRulePack();
        var findings = pack.Evaluate(trades);

        var hit = Assert.Single(findings, f => f.Id == "low-win-rate-40");
        Assert.Equal(5, hit.RelatedTradeIds!.Count);
    }

    [Fact]
    public void Evaluate_FindingsOrder_IsStableAcrossRuns()
    {
        var open = new DateTime(2024, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var trades = new[]
        {
            Trade("l1", "long", 100m, 99m, -1m, open, open.AddSeconds(10)),
            Trade("s1", "short", 100m, 101m, -1m, open.AddMinutes(1), open.AddMinutes(1).AddSeconds(10)),
            Trade("l2", "long", 100m, 99m, -1m, open.AddMinutes(2), open.AddMinutes(2).AddSeconds(10)),
            Trade("l3", "long", 100m, 99m, -1m, open.AddMinutes(3), open.AddMinutes(3).AddSeconds(10)),
            Trade("l4", "long", 100m, 99m, -1m, open.AddMinutes(4), open.AddMinutes(4).AddSeconds(10)),
        };

        var pack = new FixedRulePack();
        var first = pack.Evaluate(trades).Select(f => f.Id).ToList();
        var second = pack.Evaluate(trades).Select(f => f.Id).ToList();

        Assert.Equal(first, second);
        Assert.Equal(
            ["long-adverse-05", "short-adverse-05", "loss-cluster-3", "short-hold-60s", "low-win-rate-40"],
            first);
    }
}
