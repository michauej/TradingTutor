using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Deterministic rule pack. Empty trade list → empty findings.
/// Findings are concatenated in stable rule registration order; each rule uses a stable id.
/// </summary>
public sealed class RulePack
{
    private readonly IReadOnlyList<ICoachRule> _rules;

    public RulePack(IReadOnlyList<ICoachRule> rules)
    {
        _rules = rules;
    }

    /// <summary>Fixed hygiene pack (3–5 journal-only rules).</summary>
    public static RulePack CreateFixed() =>
        new(
        [
            new LongAdverseMoveRule(),
            new ShortAdverseMoveRule(),
            new LossClusteringRule(),
            new ShortHoldRule(),
            new LowWinRateRule()
        ]);

    public IReadOnlyList<RuleFinding> Evaluate(IReadOnlyList<ClosedTradeInput> trades)
    {
        ArgumentNullException.ThrowIfNull(trades);

        if (trades.Count == 0)
        {
            return [];
        }

        var findings = new List<RuleFinding>();
        foreach (var rule in _rules)
        {
            findings.AddRange(rule.Evaluate(trades));
        }

        return findings;
    }
}
