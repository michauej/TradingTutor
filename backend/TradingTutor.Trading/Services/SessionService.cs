using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.Trading.Services;

/// <summary>
/// Thin orchestrator for session create/get/list — keeps the controller free of storage details.
/// </summary>
public class SessionService
{
    private readonly ISessionRepository _repository;

    public SessionService(ISessionRepository repository)
    {
        _repository = repository;
    }

    public async Task<TradingSession> CreateAsync(
        TradingSession session,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        if (string.IsNullOrWhiteSpace(session.Id))
        {
            throw new ArgumentException("Session id is required.", nameof(session));
        }

        if (string.IsNullOrWhiteSpace(session.Symbol))
        {
            throw new ArgumentException("Session symbol is required.", nameof(session));
        }

        var now = DateTime.UtcNow;
        if (session.CreatedAt == default)
        {
            session.CreatedAt = now;
        }

        session.UpdatedAt = now;
        await _repository.CreateSessionAsync(session, cancellationToken);
        return session;
    }

    public Task<TradingSession?> GetAsync(string id, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        return _repository.GetSessionAsync(id, cancellationToken);
    }

    public Task<IReadOnlyList<TradingSessionSummary>> ListAsync(
        CancellationToken cancellationToken = default) =>
        _repository.ListSessionsAsync(cancellationToken);
}
