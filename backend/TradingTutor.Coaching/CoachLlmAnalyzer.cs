using Microsoft.Extensions.Logging;
using TradingTutor.Coaching.Llm;
using TradingTutor.Core.Models;

namespace TradingTutor.Coaching;

/// <summary>Owns LM Studio call + response parse for coach analyze.</summary>
public sealed class CoachLlmAnalyzer
{
    private readonly ILmStudioClient _lmClient;
    private readonly ILogger<CoachLlmAnalyzer> _logger;

    public CoachLlmAnalyzer(ILmStudioClient lmClient, ILogger<CoachLlmAnalyzer> logger)
    {
        _lmClient = lmClient;
        _logger = logger;
    }

    public async Task<(string Verdict, string Analysis)> AnalyzeAsync(
        IReadOnlyList<ClosedTradeInput> trades,
        IReadOnlyList<RuleFinding> findings,
        string? lectureContext,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(trades);
        ArgumentNullException.ThrowIfNull(findings);

        var userPrompt = CoachPromptBuilder.BuildUserPrompt(trades, findings, lectureContext);

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
                "Coach LLM failed for {TradeCount} trade(s), {FindingCount} finding(s)",
                trades.Count,
                findings.Count);
            throw;
        }

        return CoachResponseParser.Parse(assistantText);
    }
}
