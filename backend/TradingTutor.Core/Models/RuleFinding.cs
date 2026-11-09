namespace TradingTutor.Core.Models;

/// <summary>
/// Structured finding from the fixed coach rule pack.
/// </summary>
public class RuleFinding
{
    /// <summary>Stable rule id (e.g. <c>long-adverse-05</c>).</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Severity kind: <c>info</c>, <c>warning</c>, or <c>critical</c>.</summary>
    public string Severity { get; set; } = "info";

    public string Message { get; set; } = string.Empty;

    public IReadOnlyList<string>? RelatedTradeIds { get; set; }
}
