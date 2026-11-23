using TradingTutor.Core.Models;

namespace TradingTutor.Trading.Interfaces;

/// <summary>
/// Storage-agnostic port for paper-trading session persistence.
/// JSON file now; Azure Table (or other) can implement the same contract later.
/// </summary>
public interface ISessionRepository
{
    /// <summary>Insert or overwrite the full snapshot by <paramref name="session"/>.Id.</summary>
    Task CreateSessionAsync(TradingSession session, CancellationToken cancellationToken = default);

    /// <summary>Full session by id, or null if missing.</summary>
    Task<TradingSession?> GetSessionAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Session summaries, newest <see cref="TradingSessionSummary.UpdatedAt"/> first.</summary>
    Task<IReadOnlyList<TradingSessionSummary>> ListSessionsAsync(
        CancellationToken cancellationToken = default);
}
