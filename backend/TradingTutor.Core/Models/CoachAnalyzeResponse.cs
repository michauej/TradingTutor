namespace TradingTutor.Core.Models;

/// <summary>
/// Combined success payload: rule findings + LLM Verdict/Analysis (all-or-nothing).
/// </summary>
public class CoachAnalyzeResponse
{
    public IReadOnlyList<RuleFinding> Findings { get; set; } = [];
    public string Verdict { get; set; } = string.Empty;
    public string Analysis { get; set; } = string.Empty;
    public int TradeCount { get; set; }
}
