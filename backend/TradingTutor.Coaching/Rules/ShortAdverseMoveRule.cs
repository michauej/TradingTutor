using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Short-side counterpart of the PRD long/−0.5% example.
/// Formula: for side=short with entryPrice &gt; 0,
/// (exitPrice - entryPrice) / entryPrice &gt;= 0.005 → finding.
/// </summary>
public sealed class ShortAdverseMoveRule : ICoachRule
{
    public const decimal AdverseThreshold = 0.005m;

    public string RuleId => "short-adverse-05";

    public IReadOnlyList<RuleFinding> Evaluate(IReadOnlyList<ClosedTradeInput> trades)
    {
        var related = new List<string>();
        foreach (var trade in trades)
        {
            if (!string.Equals(trade.Side, "short", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (trade.EntryPrice <= 0)
            {
                continue;
            }

            var adverse = (trade.ExitPrice - trade.EntryPrice) / trade.EntryPrice;
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
                    ? "A short closed with at least ~0.5% adverse price move from entry."
                    : $"{related.Count} shorts closed with at least ~0.5% adverse price move from entry.",
                RelatedTradeIds = related
            }
        ];
    }
}
