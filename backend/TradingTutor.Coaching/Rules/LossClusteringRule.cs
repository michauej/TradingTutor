using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Loss clustering: three or more consecutive losses when trades are ordered by exit time.
/// Formula: sort by ExitTime ascending; a loss is RealizedPnl &lt; 0;
/// emit one finding if any run of consecutive losses has length &gt;= 3.
/// </summary>
public sealed class LossClusteringRule : ICoachRule
{
    public const int MinClusterSize = 3;

    public string RuleId => "loss-cluster-3";

    public IReadOnlyList<RuleFinding> Evaluate(IReadOnlyList<ClosedTradeInput> trades)
    {
        if (trades.Count == 0)
        {
            return [];
        }

        var ordered = trades.OrderBy(t => t.ExitTime).ThenBy(t => t.Id, StringComparer.Ordinal).ToList();
        var maxRun = 0;
        var run = 0;
        var clusterIds = new List<string>();
        var bestCluster = new List<string>();

        foreach (var trade in ordered)
        {
            if (trade.RealizedPnl < 0)
            {
                run++;
                clusterIds.Add(trade.Id);
                if (run > maxRun)
                {
                    maxRun = run;
                    bestCluster = [.. clusterIds];
                }
            }
            else
            {
                run = 0;
                clusterIds.Clear();
            }
        }

        if (maxRun < MinClusterSize)
        {
            return [];
        }

        return
        [
            new RuleFinding
            {
                Id = RuleId,
                Severity = "warning",
                Message = $"Found a streak of {maxRun} consecutive losing trades (by exit time).",
                RelatedTradeIds = bestCluster
            }
        ];
    }
}
