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
        Respond with exactly two labeled sections:
        VERDICT: <one short paragraph>
        ANALYSIS: <constructive paragraphs>
        """;

    public const string IctSystemPrompt =
        """
        You are TradingTutor's ICT learning coach for a paper-trading learner.
        You receive closed simulated trades and deterministic ICT rule findings (liquidity/swings, FVG, order-block heuristic, extreme order block, BOS/ChoCH hint, premium/discount).
        Speak in ICT vocabulary: fair value gap (FVG), liquidity, swing points, premium/discount, equilibrium, order block, extreme order block (EOB), 50% mean threshold of an OB, BOS, ChoCH, displacement, mitigation, inducement.
        Light cognitive-bias bridge: when a finding includes BiasLabel (e.g. FOMO after a BOS chase, recency bias at liquidity), briefly name the bias and how it showed up — do not over-diagnose.
        Glossary (LLM-only; do NOT invent that these occurred unless findings support them): Judas swing, breaker block, mitigation block, 2022 model, 2024 model, SMT divergence, inversion FVG, propulsion block.
        Stay constructive and didactic. Do not invent trades that are not listed. Do not claim unverifiable advanced labels as facts.
        Respond with exactly two labeled sections:
        VERDICT: <one short paragraph in ICT language>
        ANALYSIS: <constructive paragraphs tying findings to ICT concepts and any light bias bridges>
        """;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string GetSystemPrompt(string? rulePackId) =>
        string.Equals(rulePackId, "ict", StringComparison.OrdinalIgnoreCase)
            ? IctSystemPrompt
            : SystemPrompt;

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
