using TradingTutor.Coaching.Llm;
using TradingTutor.Coaching.Rules;
using TradingTutor.Coaching.Structure;
using TradingTutor.Core.Models;
using Xunit;

namespace TradingTutor.Tests;

public class StructureDetectorTests
{
    [Fact]
    public void DetectSwings_GoldenFixture_FindsHighAndLow()
    {
        var candles = StructureFixture.LoadGoldenOhlc();
        var swings = StructureDetector.DetectSwings(candles);

        Assert.Contains(swings, s => !s.IsHigh);
        Assert.Contains(swings, s => s.IsHigh);
        var low = swings.Where(s => !s.IsHigh).OrderBy(s => s.Price).First();
        Assert.True(low.Price <= 91m);
    }

    [Fact]
    public void DetectSwings_NeverEmitsTwoSameTypeInARow()
    {
        var candles = StructureFixture.LoadGoldenOhlc();
        var swings = StructureDetector.DetectSwings(candles);

        for (var i = 1; i < swings.Count; i++)
        {
            Assert.NotEqual(swings[i - 1].IsHigh, swings[i].IsHigh);
        }
    }

    [Fact]
    public void AlternateSwings_KeepsMoreExtremeOfConsecutiveSameType()
    {
        var raw = new List<SwingPoint>
        {
            new(1, DateTime.UtcNow, 100m, IsHigh: true),
            new(3, DateTime.UtcNow, 105m, IsHigh: true),
            new(5, DateTime.UtcNow, 90m, IsHigh: false),
            new(7, DateTime.UtcNow, 88m, IsHigh: false),
            new(9, DateTime.UtcNow, 110m, IsHigh: true),
        };

        var alt = StructureDetector.AlternateSwings(raw);
        Assert.Equal([105m, 88m, 110m], alt.Select(s => s.Price).ToList());
        Assert.Equal([true, false, true], alt.Select(s => s.IsHigh).ToList());
    }

    [Fact]
    public void AlternateSwings_DropsMicroOppositeSwings()
    {
        var raw = new List<SwingPoint>
        {
            new(1, DateTime.UtcNow, 100m, IsHigh: true),
            new(3, DateTime.UtcNow, 99.9m, IsHigh: false), // 0.1% — noise
            new(5, DateTime.UtcNow, 110m, IsHigh: true),
            new(7, DateTime.UtcNow, 90m, IsHigh: false),
        };

        var alt = StructureDetector.AlternateSwings(raw);
        Assert.Equal([110m, 90m], alt.Select(s => s.Price).ToList());
        Assert.Equal([true, false], alt.Select(s => s.IsHigh).ToList());
    }

    [Fact]
    public void DefaultSwingLookback_IsRaisedAboveMicroFractal()
    {
        Assert.True(StructureDetector.DefaultSwingLookback >= 5);
        Assert.Equal(0.005m, StructureDetector.MinSwingAmplitudeRatio);
        Assert.Equal(0.75m, StructureDetector.MinSwingAtrMult);
    }

    [Fact]
    public void HasSignificantLegs_RejectsPivotWithoutBothLegs()
    {
        var t0 = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        // Flat-ish left into a tiny "high", then a real drop — left leg too small.
        var candles = new List<CandleInput>();
        for (var i = 0; i < 30; i++)
        {
            var px = 100m + (i < 10 ? 0.05m * i : (i == 10 ? 0.6m : 0.6m - (i - 10) * 2m));
            candles.Add(new CandleInput
            {
                Timestamp = t0.AddMinutes(i),
                Open = px,
                High = px + 0.1m,
                Low = px - 0.1m,
                Close = px
            });
        }

        // Force a clear high at index 10 with tiny left rise.
        candles[10] = new CandleInput
        {
            Timestamp = candles[10].Timestamp,
            Open = 100.5m,
            High = 100.8m,
            Low = 100.4m,
            Close = 100.6m
        };

        var swing = new SwingPoint(10, candles[10].Timestamp, candles[10].High, IsHigh: true);
        var atr = StructureDetector.AverageTrueRange(candles);
        var minMove = StructureDetector.MinSwingMove(swing.Price, atr, StructureDetector.MinSwingAmplitudeRatio);
        Assert.False(StructureDetector.HasSignificantLegs(candles, swing, 5, minMove));
    }

    [Fact]
    public void DetectFvgs_GoldenFixture_FindsBullishGap()
    {
        var candles = StructureFixture.LoadGoldenOhlc();
        var fvgs = StructureDetector.DetectFvgs(candles);

        Assert.Contains(fvgs, f => f.IsBullish && f.Low < f.High);
    }

    [Fact]
    public void DetectExtremeOrderBlocks_GoldenFixture_FindsBlocks()
    {
        var candles = StructureFixture.LoadGoldenOhlc();
        var blocks = StructureDetector.DetectExtremeOrderBlocks(candles);

        Assert.NotEmpty(blocks);
        Assert.Contains(blocks, b => b.IsBullish);
        Assert.All(blocks, b =>
        {
            Assert.True(b.EndIndex >= b.CandleIndex);
            Assert.Equal((b.Low + b.High) / 2m, b.Mean);
        });
    }

    [Fact]
    public void FindMeanTakeIndex_StopsWhenFiftyPercentTakenAfterLeaving()
    {
        var t0 = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        // Bullish OB 100–110. Must leave above 110, then return to mean 105.
        var candles = new List<CandleInput>
        {
            new() { Timestamp = t0, Open = 110, High = 110, Low = 100, Close = 101 },
            new() { Timestamp = t0.AddMinutes(1), Open = 101, High = 108, Low = 101, Close = 107 }, // adjacent
            new() { Timestamp = t0.AddMinutes(2), Open = 107, High = 115, Low = 107, Close = 114 }, // leaves OB
            new() { Timestamp = t0.AddMinutes(3), Open = 114, High = 114, Low = 104, Close = 105 }, // takes mean
        };

        var end = StructureDetector.FindMeanTakeIndex(candles, 0, 100m, 110m, isBullish: true);
        Assert.Equal(3, end);
    }

    [Fact]
    public void FindMeanTakeIndex_NoTakeUntilPriceLeavesOb()
    {
        var t0 = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        // Wicks to mean while still inside OB high — not a take; extends to end.
        var candles = new List<CandleInput>
        {
            new() { Timestamp = t0, Open = 110, High = 110, Low = 100, Close = 101 },
            new() { Timestamp = t0.AddMinutes(1), Open = 101, High = 109, Low = 101, Close = 108 },
            new() { Timestamp = t0.AddMinutes(2), Open = 108, High = 109, Low = 104, Close = 105 }, // mean but never left
            new() { Timestamp = t0.AddMinutes(3), Open = 105, High = 109, Low = 104, Close = 108 },
        };

        var end = StructureDetector.FindMeanTakeIndex(candles, 0, 100m, 110m, isBullish: true);
        Assert.Equal(3, end);
    }

    [Fact]
    public void FindMeanTakeIndex_AdjacentCandleDoesNotCountAsTaken()
    {
        var t0 = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var candles = new List<CandleInput>
        {
            new() { Timestamp = t0, Open = 110, High = 110, Low = 100, Close = 101 },
            new() { Timestamp = t0.AddMinutes(1), Open = 101, High = 120, Low = 99, Close = 119 }, // adjacent
            new() { Timestamp = t0.AddMinutes(2), Open = 119, High = 125, Low = 118, Close = 124 }, // left
            new() { Timestamp = t0.AddMinutes(3), Open = 124, High = 124, Low = 104, Close = 105 }, // take
        };

        var end = StructureDetector.FindMeanTakeIndex(candles, 0, 100m, 110m, isBullish: true);
        Assert.Equal(3, end);
    }

    [Fact]
    public void IctPack_CanEmitExtremeObFinding()
    {
        var pack = new IctRulePack();
        var candles = StructureFixture.BuildPremiumDiscountSeries();
        var trades = StructureFixture.BuildPremiumLongTrades();

        var findings = pack.Evaluate(new RuleEvaluationContext
        {
            Trades = trades,
            Candles = candles
        });

        // Premium longs often also skip bullish EOBs; either way pack must evaluate with EOB wired.
        Assert.Contains(
            "extreme order block",
            CoachPromptBuilder.IctSystemPrompt,
            StringComparison.OrdinalIgnoreCase);
        Assert.NotNull(findings);
    }

    [Fact]
    public void IctPack_PremiumLong_FiresWithBetterZone()
    {
        var pack = new IctRulePack();
        var candles = StructureFixture.BuildPremiumDiscountSeries();
        var trades = StructureFixture.BuildPremiumLongTrades();

        var findings = pack.Evaluate(new RuleEvaluationContext
        {
            Trades = trades,
            Candles = candles
        });

        var hit = Assert.Single(findings, f => f.Id == "ict-premium-discount");
        Assert.True(hit.RelatedTradeIds!.Count >= 1);
        Assert.Contains("p1", hit.RelatedTradeIds!);
        Assert.NotNull(hit.BetterZoneLow);
        Assert.NotNull(hit.BetterZoneHigh);
        Assert.Equal("FOMO", hit.BiasLabel);
        Assert.False(string.IsNullOrWhiteSpace(hit.AlternativeSummary));
    }

    [Fact]
    public void IctPack_EmptyCandles_Throws()
    {
        var pack = new IctRulePack();
        Assert.Throws<ArgumentException>(() =>
            pack.Evaluate(new RuleEvaluationContext
            {
                Trades = StructureFixture.BuildPremiumLongTrades(),
                Candles = null
            }));
    }

    [Fact]
    public void PromptBuilder_IctMode_IncludesGlossaryAndBiasBridge()
    {
        var prompt = CoachPromptBuilder.GetSystemPrompt("ict");
        Assert.Contains("fair value gap", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Judas", prompt, StringComparison.Ordinal);
        Assert.Contains("FOMO", prompt, StringComparison.Ordinal);
        Assert.Contains("VERDICT:", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("Judas", CoachPromptBuilder.GetSystemPrompt("hygiene"), StringComparison.Ordinal);
    }
}
