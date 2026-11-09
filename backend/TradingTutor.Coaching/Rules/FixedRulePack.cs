using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Deterministic fixed rule pack (3–5 rules). Empty trade list → empty findings.
/// Findings are concatenated in stable rule registration order; each rule uses a stable id.
/// </summary>
public sealed class FixedRulePack
{
    private readonly IReadOnlyList<ICoachRule> _rules;

    public FixedRulePack()
        : this(
        [
            new LongAdverseMoveRule(),
            new ShortAdverseMoveRule(),
            new LossClusteringRule(),
            new ShortHoldRule(),
            new LowWinRateRule()
        ])
    {
    }

    public FixedRulePack(IReadOnlyList<ICoachRule> rules)
    {
        _rules = rules;
    }

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
