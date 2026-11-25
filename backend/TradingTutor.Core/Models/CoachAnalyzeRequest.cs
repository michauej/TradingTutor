namespace TradingTutor.Core.Models;

/// <summary>Analyze closed trades from a persisted session (single supported path).</summary>
public class CoachAnalyzeRequest
{
    public string SessionId { get; set; } = string.Empty;
}
