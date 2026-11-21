using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Shared evaluation input for rule packs (trades + optional candle prefix).
/// </summary>
public sealed class RuleEvaluationContext
{
    public required IReadOnlyList<ClosedTradeInput> Trades { get; init; }

    public IReadOnlyList<CandleInput>? Candles { get; init; }
}
