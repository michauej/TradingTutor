namespace TradingTutor.Coaching.Rules;

/// <summary>
/// Resolves rule packs by id. Unknown id → <see cref="ArgumentException"/>.
/// </summary>
public sealed class RulePackRegistry
{
    public const string DefaultPackId = "hygiene";

    private readonly Dictionary<string, IRulePack> _packs;

    public RulePackRegistry(IEnumerable<IRulePack> packs)
    {
        _packs = new Dictionary<string, IRulePack>(StringComparer.OrdinalIgnoreCase);
        foreach (var pack in packs)
        {
            _packs[pack.PackId] = pack;
        }

        if (!_packs.ContainsKey(DefaultPackId))
        {
            throw new InvalidOperationException(
                $"Rule pack registry must include the default '{DefaultPackId}' pack.");
        }
    }

    public IRulePack Resolve(string? rulePackId)
    {
        var id = string.IsNullOrWhiteSpace(rulePackId)
            ? DefaultPackId
            : rulePackId.Trim();

        if (!_packs.TryGetValue(id, out var pack))
        {
            throw new ArgumentException(
                $"Unknown rule pack '{id}'. Known packs: {string.Join(", ", _packs.Keys.OrderBy(k => k, StringComparer.Ordinal))}.",
                nameof(rulePackId));
        }

        return pack;
    }
}
