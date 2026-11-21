using System.Text.Json;
using TradingTutor.Coaching.Rules;
using TradingTutor.Core.Models;
using Xunit;

namespace TradingTutor.Tests;

public class RulePackRegistryTests
{
    private static RulePackRegistry CreateRegistry() =>
        new([new FixedRulePack(), new IctRulePack()]);

    [Fact]
    public void Resolve_NullOrEmpty_DefaultsToHygiene()
    {
        var registry = CreateRegistry();
        Assert.Equal("hygiene", registry.Resolve(null).PackId);
        Assert.Equal("hygiene", registry.Resolve("").PackId);
        Assert.Equal("hygiene", registry.Resolve("  ").PackId);
    }

    [Fact]
    public void Resolve_UnknownPack_ThrowsArgumentException()
    {
        var registry = CreateRegistry();
        var ex = Assert.Throws<ArgumentException>(() => registry.Resolve("unknown"));
        Assert.Contains("Unknown rule pack", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void RuleFinding_OptionalZoneFields_SerializeAsCamelCase()
    {
        var finding = new RuleFinding
        {
            Id = "ict-premium-discount",
            Severity = "warning",
            Message = "Long into premium",
            RelatedTradeIds = ["t1"],
            AlternativeSummary = "Buy discount",
            BetterZoneLow = 90m,
            BetterZoneHigh = 100m,
            BiasLabel = "FOMO"
        };

        var json = JsonSerializer.Serialize(
            finding,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        Assert.Contains("\"alternativeSummary\":\"Buy discount\"", json, StringComparison.Ordinal);
        Assert.Contains("\"betterZoneLow\":90", json, StringComparison.Ordinal);
        Assert.Contains("\"betterZoneHigh\":100", json, StringComparison.Ordinal);
        Assert.Contains("\"biasLabel\":\"FOMO\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void HygienePack_IgnoresMissingCandles()
    {
        var pack = new FixedRulePack();
        var trades = new[]
        {
            new ClosedTradeInput
            {
                Id = "t1",
                Side = "long",
                Qty = 1m,
                EntryPrice = 100m,
                EntryTime = DateTime.UtcNow,
                ExitPrice = 99m,
                ExitTime = DateTime.UtcNow.AddMinutes(1),
                RealizedPnl = -1m
            }
        };

        var findings = pack.Evaluate(new RuleEvaluationContext { Trades = trades, Candles = null });
        Assert.Contains(findings, f => f.Id == "long-adverse-05");
    }
}
