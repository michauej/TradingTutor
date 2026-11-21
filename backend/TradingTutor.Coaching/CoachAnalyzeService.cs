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

    private readonly RulePackRegistry _registry;
    private readonly ILmStudioClient _lmClient;
    private readonly LectureContextLoader _lectureLoader;
    private readonly ILogger<CoachAnalyzeService> _logger;

    public CoachAnalyzeService(
        RulePackRegistry registry,
        ILmStudioClient lmClient,
        LectureContextLoader lectureLoader,
        ILogger<CoachAnalyzeService> logger)
    {
        _registry = registry;
        _lmClient = lmClient;
        _lectureLoader = lectureLoader;
        _logger = logger;
    }

    public Task<CoachAnalyzeResponse> AnalyzeAsync(
        IReadOnlyList<ClosedTradeInput> trades,
        CancellationToken cancellationToken = default) =>
        AnalyzeAsync(trades, RulePackRegistry.DefaultPackId, null, cancellationToken);

    public async Task<CoachAnalyzeResponse> AnalyzeAsync(
        IReadOnlyList<ClosedTradeInput> trades,
        string? rulePackId,
        IReadOnlyList<CandleInput>? candles,
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

        var pack = _registry.Resolve(rulePackId);
        var payload = CandlePayloadPolicy.Apply(candles, trades);
        if (!string.IsNullOrEmpty(payload.Note))
        {
            _logger.LogInformation("{CandlePolicyNote}", payload.Note);
        }

        if (string.Equals(pack.PackId, IctRulePack.PackIdValue, StringComparison.OrdinalIgnoreCase)
            && payload.Candles.Count == 0)
        {
            throw new ArgumentException(
                "ICT rule pack requires a non-empty candles array (session candle prefix).",
                nameof(candles));
        }

        var sw = Stopwatch.StartNew();
        var context = new RuleEvaluationContext
        {
            Trades = trades,
            Candles = payload.Candles.Count > 0 ? payload.Candles : null
        };
        var findings = pack.Evaluate(context);
        _logger.LogInformation(
            "Coach rules ({RulePackId}) produced {FindingCount} finding(s) for {TradeCount} trade(s)",
            pack.PackId,
            findings.Count,
            trades.Count);

        var lecture = _lectureLoader.Load();
        var userPrompt = CoachPromptBuilder.BuildUserPrompt(trades, findings, lecture);
        var systemPrompt = CoachPromptBuilder.GetSystemPrompt(pack.PackId);

        string assistantText;
        try
        {
            assistantText = await _lmClient.CompleteChatAsync(
                systemPrompt,
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
            "Coach analyze succeeded in {ElapsedMs}ms for {TradeCount} trade(s), {FindingCount} finding(s), pack {RulePackId}",
            sw.ElapsedMilliseconds,
            trades.Count,
            findings.Count,
            pack.PackId);

        return new CoachAnalyzeResponse
        {
            Findings = findings,
            Verdict = verdict,
            Analysis = analysis,
            TradeCount = trades.Count,
            RulePackId = pack.PackId,
            CandlePolicyNote = payload.Note
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
