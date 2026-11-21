namespace TradingTutor.Core.Models;

/// <summary>
/// Structured finding from a coach rule pack.
/// </summary>
public class RuleFinding
{
    /// <summary>Stable rule id (e.g. <c>long-adverse-05</c>).</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Severity kind: <c>info</c>, <c>warning</c>, or <c>critical</c>.</summary>
    public string Severity { get; set; } = "info";

    public string Message { get; set; } = string.Empty;

    public IReadOnlyList<string>? RelatedTradeIds { get; set; }

    /// <summary>Qualitative better-alternative text when a numeric zone is not available.</summary>
    public string? AlternativeSummary { get; set; }

    public decimal? BetterZoneLow { get; set; }

    public decimal? BetterZoneHigh { get; set; }

    public DateTime? BetterZoneStart { get; set; }

    public DateTime? BetterZoneEnd { get; set; }

    /// <summary>Optional cognitive-bias bridge label (e.g. FOMO).</summary>
    public string? BiasLabel { get; set; }
}
