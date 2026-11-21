using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Deterministic hygiene rule pack (journal-only). Empty trade list → empty findings.
/// Findings are concatenated in stable rule registration order; each rule uses a stable id.
/// Candles are ignored when present.
/// </summary>
public sealed class FixedRulePack : IRulePack
{
    public const string PackIdValue = "hygiene";

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

    public string PackId => PackIdValue;

    public IReadOnlyList<RuleFinding> Evaluate(RuleEvaluationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return Evaluate(context.Trades);
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
