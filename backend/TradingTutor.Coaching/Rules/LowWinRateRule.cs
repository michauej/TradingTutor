using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Low win rate on the batch when there are at least 5 trades.
/// Formula: win = RealizedPnl &gt; 0; winRate = wins / count; fire when winRate &lt; 0.40.
/// Breakeven (PnL == 0) counts as neither win nor loss for the numerator (not a win).
/// </summary>
public sealed class LowWinRateRule : ICoachRule
{
    public const int MinTrades = 5;
    public const decimal WinRateThreshold = 0.50m;

    public string RuleId => "low-win-rate-50";

    public IReadOnlyList<RuleFinding> Evaluate(IReadOnlyList<ClosedTradeInput> trades)
    {
        if (trades.Count < MinTrades)
        {
            return [];
        }

        var wins = trades.Count(t => t.RealizedPnl > 0);
        var winRate = (decimal)wins / trades.Count;
        if (winRate >= WinRateThreshold)
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
                    $"Batch win rate is {winRate:P0} ({wins}/{trades.Count}), below the {WinRateThreshold:P0} coaching threshold.",
                RelatedTradeIds = trades.Select(t => t.Id).ToList()
            }
        ];
    }
}
