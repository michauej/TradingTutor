using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Single fixed behavioral rule over closed trades (no candle series).
/// </summary>
public interface ICoachRule
{
    string RuleId { get; }

    IReadOnlyList<RuleFinding> Evaluate(IReadOnlyList<ClosedTradeInput> trades);
}
