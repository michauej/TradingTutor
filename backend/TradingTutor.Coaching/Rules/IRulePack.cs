using TradingTutor.Core.Models;

namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Selectable deterministic rule pack (hygiene, ICT, …).
/// </summary>
public interface IRulePack
{
    string PackId { get; }

    IReadOnlyList<RuleFinding> Evaluate(RuleEvaluationContext context);
}
