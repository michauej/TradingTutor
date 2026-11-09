using System.Diagnostics;
using Microsoft.Extensions.Logging;
using TradingTutor.Coaching.Llm;
using TradingTutor.Coaching.Rules;
using TradingTutor.Core.Models;

namespace TradingTutor.Coaching;

/// <summary>
/// Orchestrates rules → prompt → LM Studio → combined success DTO.
/// Findings are only returned together with Verdict/Analysis (all-or-nothing).
/// </summary>
public sealed class CoachAnalyzeService
{
    public const int MinimumClosedTrades = 5;

    private readonly FixedRulePack _rulePack;
    private readonly ILmStudioClient _lmClient;
    private readonly LectureContextLoader _lectureLoader;
    private readonly ILogger<CoachAnalyzeService> _logger;

    public CoachAnalyzeService(
        FixedRulePack rulePack,
        ILmStudioClient lmClient,
        LectureContextLoader lectureLoader,
        ILogger<CoachAnalyzeService> logger)
    {
        _rulePack = rulePack;
        _lmClient = lmClient;
        _lectureLoader = lectureLoader;
        _logger = logger;
    }

    public async Task<CoachAnalyzeResponse> AnalyzeAsync(
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
        var userPrompt = CoachPromptBuilder.BuildUserPrompt(trades, findings, lecture);

        string assistantText;
        try
        {
            assistantText = await _lmClient.CompleteChatAsync(
                CoachPromptBuilder.SystemPrompt,
                userPrompt,
                cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(
                ex,
                "Coach LLM failed after {ElapsedMs}ms for {TradeCount} trade(s), {FindingCount} finding(s) — no findings returned",
                sw.ElapsedMilliseconds,
                trades.Count,
                findings.Count);
            throw;
        }

        var (verdict, analysis) = CoachResponseParser.Parse(assistantText);
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
