using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TradingTutor.Coaching;
using TradingTutor.Coaching.Llm;
using TradingTutor.Coaching.Rules;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
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

    private static CoachAnalyzeService CreateService(
        ILmStudioClient lm,
        ISessionRepository? sessions = null) =>
        new(
            RulePack.CreateFixed(),
            lm,
            new LectureContextLoader(
                Options.Create(new CoachOptions { PdfFolder = "" }),
                NullLogger<LectureContextLoader>.Instance),
            sessions ?? new FakeSessionStore(),
            NullLogger<CoachAnalyzeService>.Instance);

    [Fact]
    public async Task AnalyzeTradesAsync_UnderFiveTrades_ThrowsArgumentException()
    {
        var service = CreateService(new FakeLmClient("VERDICT: ok\nANALYSIS: fine"));
        var ex = await Assert.ThrowsAsync<ArgumentException>(
            () => service.AnalyzeTradesAsync([Trade("1"), Trade("2")]));
        Assert.Contains("At least 5", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnalyzeTradesAsync_LmSuccess_ReturnsFindingsWithVerdict()
    {
        var lm = new FakeLmClient("VERDICT: Solid session\nANALYSIS: Keep sizing consistent.");
        var service = CreateService(lm);

        var result = await service.AnalyzeTradesAsync(FiveTrades());

        Assert.Equal(5, result.TradeCount);
        Assert.Equal("Solid session", result.Verdict);
        Assert.Equal("Keep sizing consistent.", result.Analysis);
        Assert.NotNull(result.Findings);
        Assert.Contains("TradingTutor", lm.LastSystemPrompt!, StringComparison.Ordinal);
        Assert.Contains("Closed trades", lm.LastUserPrompt!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnalyzeTradesAsync_LmFailure_PropagatesWithoutReturningFindings()
    {
        var lm = new FakeLmClient(null, new LmStudioException("down"));
        var service = CreateService(lm);

        var ex = await Assert.ThrowsAsync<LmStudioException>(
            () => service.AnalyzeTradesAsync(FiveTrades()));
        Assert.Equal("down", ex.Message);
    }

    [Fact]
    public async Task AnalyzeTradesAsync_InvalidSide_ThrowsBeforeLmCall()
    {
        var lm = new FakeLmClient("VERDICT: x\nANALYSIS: y");
        var service = CreateService(lm);
        var trades = FiveTrades();
        trades[0].Side = "flat";

        await Assert.ThrowsAsync<ArgumentException>(() => service.AnalyzeTradesAsync(trades));
        Assert.Equal(0, lm.CallCount);
    }

    [Fact]
    public async Task AnalyzeBySessionAsync_LoadsTradesPersistsCoachFields()
    {
        var store = new FakeSessionStore();
        store.Sessions["s1"] = new TradingSession
        {
            Id = "s1",
            Symbol = "BTCUSDT",
            ClosedTrades = FiveTrades()
        };
        var lm = new FakeLmClient("VERDICT: Good\nANALYSIS: Stay patient.");
        var service = CreateService(lm, store);

        var result = await service.AnalyzeBySessionAsync("s1");

        Assert.Equal("Good", result.Verdict);
        var saved = store.Sessions["s1"];
        Assert.Equal("Good", saved.CoachVerdict);
        Assert.Equal("Stay patient.", saved.CoachAnalysis);
        Assert.NotNull(saved.CoachAnalyzedAt);
        Assert.Equal(result.Findings.Count, saved.CoachFindings.Count);
    }

    [Fact]
    public async Task AnalyzeBySessionAsync_MissingSession_Throws()
    {
        var service = CreateService(new FakeLmClient("VERDICT: x\nANALYSIS: y"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.AnalyzeBySessionAsync("missing"));
    }

    private sealed class FakeSessionStore : ISessionRepository
    {
        public Dictionary<string, TradingSession> Sessions { get; } = new(StringComparer.Ordinal);

        public Task CreateSessionAsync(
            TradingSession session,
            CancellationToken cancellationToken = default)
        {
            Sessions[session.Id] = session;
            return Task.CompletedTask;
        }

        public Task<TradingSession?> GetSessionAsync(
            string id,
            CancellationToken cancellationToken = default)
        {
            Sessions.TryGetValue(id, out var session);
            return Task.FromResult(session);
        }

        public Task<IReadOnlyList<TradingSessionSummary>> ListSessionsAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<TradingSessionSummary>>([]);
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
