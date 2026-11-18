using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Flags trades held for under 60 seconds (by entry→exit wall time).
/// </summary>
public sealed class ShortHoldRule : ICoachRule
{
    public static readonly TimeSpan Threshold = TimeSpan.FromSeconds(60);

    public string RuleId => "short-hold-60s";

    public IReadOnlyList<RuleFinding> Evaluate(IReadOnlyList<ClosedTradeInput> trades)
    {
        var hits = trades
            .Where(t => t.ExitTime - t.EntryTime < Threshold)
            .ToList();

        if (hits.Count == 0)
        {
            return [];
        }

        return
        [
            new RuleFinding
            {
                Id = RuleId,
                Severity = "warning",
                Message =
                    $"Found {hits.Count} trade(s) held under {Threshold.TotalSeconds:0} seconds.",
                RelatedTradeIds = hits.Select(t => t.Id).ToList()
            }
        ];
    }
}
