using System.Text;
using System.Text.Json;
using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Llm;

/// <summary>
/// Assembles the fixed head (system) prompt and user payload (findings + trades + optional lecture text).
/// </summary>
public static class CoachPromptBuilder
{
    public const string SystemPrompt =
        """
        You are TradingTutor's trading coach for a paper-trading learner.
        You receive closed simulated trades and deterministic rule findings.
        Analyze the trades and try to find the links behaviours between the them.
        On the basis of the links, tell the learner what they are doing well and what they could improve.
        Stay constructive. Do not invent trades that are not listed.
        """;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string BuildUserPrompt(
        IReadOnlyList<ClosedTradeInput> trades,
        IReadOnlyList<RuleFinding> findings,
        string? lectureContext)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Closed trades ({trades.Count}):");
        sb.AppendLine(JsonSerializer.Serialize(trades.Select(SummarizeTrade), JsonOptions));
        sb.AppendLine();
        sb.AppendLine($"Rule findings ({findings.Count}):");
        sb.AppendLine(JsonSerializer.Serialize(findings, JsonOptions));

        if (!string.IsNullOrWhiteSpace(lectureContext))
        {
            sb.AppendLine();
            sb.AppendLine("Optional lecture notes (truncated):");
            sb.AppendLine(lectureContext.Trim());
        }

        return sb.ToString();
    }

    private static object SummarizeTrade(ClosedTradeInput t) => new
    {
        t.Id,
        t.Side,
        t.Qty,
        t.EntryPrice,
        EntryTime = t.EntryTime.ToUniversalTime().ToString("O"),
        t.ExitPrice,
        ExitTime = t.ExitTime.ToUniversalTime().ToString("O"),
        t.RealizedPnl
    };
}
