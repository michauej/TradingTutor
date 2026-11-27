using System.Diagnostics;
using Microsoft.Extensions.Logging;
using TradingTutor.Coaching.Llm;
using TradingTutor.Coaching.Rules;
using TradingTutor.Core.Models;

namespace TradingTutor.Coaching;

/// <summary>
/// Pure analyze: rules → lecture prompt → LLM → DTO.
/// Session load/persist lives in the API controller.
/// </summary>
public sealed class CoachAnalyzeService
{
    public const int MinimumClosedTrades = 5;

    private readonly RulePack _rulePack;
    private readonly LectureContextLoader _lectureLoader;
    private readonly CoachLlmAnalyzer _llmAnalyzer;
    private readonly ILogger<CoachAnalyzeService> _logger;

    public CoachAnalyzeService(
        RulePack rulePack,
        LectureContextLoader lectureLoader,
        CoachLlmAnalyzer llmAnalyzer,
        ILogger<CoachAnalyzeService> logger)
    {
        _rulePack = rulePack;
        _lectureLoader = lectureLoader;
        _llmAnalyzer = llmAnalyzer;
        _logger = logger;
    }

    public async Task<CoachAnalyzeResponse> AnalyzeTradesAsync(
        IReadOnlyList<ClosedTradeInput> trades,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(trades);

        if (trades.Count < MinimumClosedTrades)
        {
            throw new ArgumentException(
                $"At least {MinimumClosedTrades} closed trades are required for analysis (got {trades.Count}).",
                nameof(trades));
        }

        foreach (var trade in trades)
        {
            ValidateTrade(trade);
        }

        var sw = Stopwatch.StartNew();
        var findings = _rulePack.Evaluate(trades);
        _logger.LogInformation(
            "Coach rules produced {FindingCount} finding(s) for {TradeCount} trade(s)",
            findings.Count,
            trades.Count);

        var lecture = _lectureLoader.Load();
        var (verdict, analysis) = await _llmAnalyzer.AnalyzeAsync(
            trades,
            findings,
            lecture,
            cancellationToken);

        sw.Stop();
        _logger.LogInformation(
            "Coach analyze succeeded in {ElapsedMs}ms for {TradeCount} trade(s), {FindingCount} finding(s)",
            sw.ElapsedMilliseconds,
            trades.Count,
            findings.Count);

        return new CoachAnalyzeResponse
        {
            Findings = findings,
            Verdict = verdict,
            Analysis = analysis,
            TradeCount = trades.Count
        };
    }

    private static void ValidateTrade(ClosedTradeInput trade)
    {
        if (string.IsNullOrWhiteSpace(trade.Id))
        {
            throw new ArgumentException("Each closed trade requires a non-empty id.");
        }

        if (!string.Equals(trade.Side, "long", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(trade.Side, "short", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"Trade '{trade.Id}' has invalid side '{trade.Side}' (expected long|short).");
        }

        if (trade.Qty <= 0)
        {
            throw new ArgumentException($"Trade '{trade.Id}' qty must be positive.");
        }

        if (trade.EntryPrice <= 0 || trade.ExitPrice <= 0)
        {
            throw new ArgumentException($"Trade '{trade.Id}' prices must be positive.");
        }
    }
}
