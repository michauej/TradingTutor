using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// PRD example: after a long, ~0.5% adverse move.
/// Formula: for side=long with entryPrice &gt; 0,
/// (entryPrice - exitPrice) / entryPrice &gt;= 0.005 → finding.
/// </summary>
public sealed class LongAdverseMoveRule : ICoachRule
{
    public const decimal AdverseThreshold = 0.005m;

    public string RuleId => "long-adverse-05";

    public IReadOnlyList<RuleFinding> Evaluate(IReadOnlyList<ClosedTradeInput> trades)
    {
        var related = new List<string>();
        foreach (var trade in trades)
        {
            if (!string.Equals(trade.Side, "long", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (trade.EntryPrice <= 0)
            {
                continue;
            }

            var adverse = (trade.EntryPrice - trade.ExitPrice) / trade.EntryPrice;
            if (adverse >= AdverseThreshold)
            {
                related.Add(trade.Id);
            }
        }

        if (related.Count == 0)
        {
            return [];
        }

        return
        [
            new RuleFinding
            {
                Id = RuleId,
                Severity = "warning",
                Message = related.Count == 1
                    ? "A long closed with at least ~0.5% adverse price move from entry."
                    : $"{related.Count} longs closed with at least ~0.5% adverse price move from entry.",
                RelatedTradeIds = related
            }
        ];
    }
}
