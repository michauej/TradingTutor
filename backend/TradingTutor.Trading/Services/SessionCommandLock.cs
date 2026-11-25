using System.Collections.Concurrent;

namespace TradingTutor.Trading.Services;

/// <summary>
/// Process-wide per-session gates so concurrent HTTP requests serialize
/// read-modify-write on the same session id (Singleton DI lifetime).
/// </summary>
public sealed class SessionCommandLock
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates =
        new(StringComparer.Ordinal);

    public SemaphoreSlim GetGate(string sessionId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sessionId);
        return _gates.GetOrAdd(sessionId, _ => new SemaphoreSlim(1, 1));
    }
}
