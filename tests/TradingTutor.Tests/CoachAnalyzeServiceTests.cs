using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TradingTutor.Coaching;
using TradingTutor.Coaching.Llm;
using TradingTutor.Coaching.Rules;
using TradingTutor.Core.Models;
using Xunit;

namespace TradingTutor.Tests;

public class CoachAnalyzeServiceTests
{
    private static ClosedTradeInput Trade(string id, decimal pnl = 1m) => new()
    {
        Id = id,
        Side = "long",
        Qty = 1m,
        EntryPrice = 100m,
        EntryTime = new DateTime(2024, 1, 1, 12, 0, 0, DateTimeKind.Utc),
        ExitPrice = 101m,
        ExitTime = new DateTime(2024, 1, 1, 12, 10, 0, DateTimeKind.Utc),
        RealizedPnl = pnl
    };

    private static List<ClosedTradeInput> FiveTrades() =>
    [
        Trade("1"),
        Trade("2"),
        Trade("3"),
        Trade("4"),
        Trade("5")
    ];

    private static RulePackRegistry CreateRegistry() =>
        new([new FixedRulePack(), new IctRulePack()]);

    private static CoachAnalyzeService CreateService(ILmStudioClient lm) =>
        new(
            CreateRegistry(),
            lm,
            new LectureContextLoader(
                Options.Create(new CoachOptions { PdfFolder = "" }),
                NullLogger<LectureContextLoader>.Instance),
            NullLogger<CoachAnalyzeService>.Instance);

    [Fact]
    public async Task AnalyzeAsync_UnderFiveTrades_ThrowsArgumentException()
    {
        var service = CreateService(new FakeLmClient("VERDICT: ok\nANALYSIS: fine"));
        var ex = await Assert.ThrowsAsync<ArgumentException>(
            () => service.AnalyzeAsync([Trade("1"), Trade("2")]));
        Assert.Contains("At least 5", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnalyzeAsync_LmSuccess_ReturnsFindingsWithVerdict()
    {
        var lm = new FakeLmClient("VERDICT: Solid session\nANALYSIS: Keep sizing consistent.");
        var service = CreateService(lm);

        var result = await service.AnalyzeAsync(FiveTrades());

        Assert.Equal(5, result.TradeCount);
        Assert.Equal("Solid session", result.Verdict);
        Assert.Equal("Keep sizing consistent.", result.Analysis);
        Assert.Equal("hygiene", result.RulePackId);
        Assert.NotNull(result.Findings);
        Assert.Contains("TradingTutor", lm.LastSystemPrompt!, StringComparison.Ordinal);
        Assert.Contains("Closed trades", lm.LastUserPrompt!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnalyzeAsync_UnknownPack_ThrowsArgumentException()
    {
        var lm = new FakeLmClient("VERDICT: x\nANALYSIS: y");
        var service = CreateService(lm);

        var ex = await Assert.ThrowsAsync<ArgumentException>(
            () => service.AnalyzeAsync(FiveTrades(), "nope", null));
        Assert.Contains("Unknown rule pack", ex.Message, StringComparison.Ordinal);
        Assert.Equal(0, lm.CallCount);
    }

    [Fact]
    public async Task AnalyzeAsync_IctWithoutCandles_ThrowsArgumentException()
    {
        var lm = new FakeLmClient("VERDICT: x\nANALYSIS: y");
        var service = CreateService(lm);

        var ex = await Assert.ThrowsAsync<ArgumentException>(
            () => service.AnalyzeAsync(FiveTrades(), "ict", null));
        Assert.Contains("non-empty candles", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, lm.CallCount);
    }

    [Fact]
    public async Task AnalyzeAsync_IctWithCandles_ReturnsFindingsIncludingBetterZone()
    {
        var lm = new FakeLmClient("VERDICT: ICT session\nANALYSIS: Watch premium entries.");
        var service = CreateService(lm);
        var candles = StructureFixture.BuildPremiumDiscountSeries();
        var trades = StructureFixture.BuildPremiumLongTrades();

        var result = await service.AnalyzeAsync(trades, "ict", candles);

        Assert.Equal("ict", result.RulePackId);
        var premium = Assert.Single(result.Findings, f => f.Id == "ict-premium-discount");
        Assert.NotNull(premium.BetterZoneLow);
        Assert.NotNull(premium.BetterZoneHigh);
        Assert.NotNull(premium.AlternativeSummary);
        Assert.Contains(result.Findings, f => f.BetterZoneLow is not null && f.BetterZoneHigh is not null);
        Assert.Contains("ICT", lm.LastSystemPrompt!, StringComparison.Ordinal);
        Assert.Contains("FOMO", lm.LastSystemPrompt!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnalyzeAsync_LmFailure_PropagatesWithoutReturningFindings()
    {
        var lm = new FakeLmClient(null, new LmStudioException("down"));
        var service = CreateService(lm);

        var ex = await Assert.ThrowsAsync<LmStudioException>(
            () => service.AnalyzeAsync(FiveTrades()));
        Assert.Equal("down", ex.Message);
    }

    [Fact]
    public async Task AnalyzeAsync_InvalidSide_ThrowsBeforeLmCall()
    {
        var lm = new FakeLmClient("VERDICT: x\nANALYSIS: y");
        var service = CreateService(lm);
        var trades = FiveTrades();
        trades[0].Side = "flat";

        await Assert.ThrowsAsync<ArgumentException>(() => service.AnalyzeAsync(trades));
        Assert.Equal(0, lm.CallCount);
    }

    private sealed class FakeLmClient : ILmStudioClient
    {
        private readonly string? _reply;
        private readonly Exception? _error;

        public FakeLmClient(string? reply, Exception? error = null)
        {
            _reply = reply;
            _error = error;
        }

        public int CallCount { get; private set; }
        public string? LastSystemPrompt { get; private set; }
        public string? LastUserPrompt { get; private set; }

        public Task<string> CompleteChatAsync(
            string systemPrompt,
            string userPrompt,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            LastSystemPrompt = systemPrompt;
            LastUserPrompt = userPrompt;
            if (_error is not null)
            {
                throw _error;
            }

            return Task.FromResult(_reply ?? string.Empty);
        }
    }
}
