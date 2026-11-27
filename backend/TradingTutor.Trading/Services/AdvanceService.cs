using Microsoft.Extensions.Logging;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.Trading.Services;

/// <summary>Candle-driven advance / sim clock for a loaded session (lock owned by facade).</summary>
public class AdvanceService
{
    private readonly ISessionRepository _repository;
    private readonly ICandleLoadService _candles;
    private readonly PaperTradingEngine _engine;
    private readonly ILogger<AdvanceService> _logger;

    public AdvanceService(
        ISessionRepository repository,
        ICandleLoadService candles,
        PaperTradingEngine? engine = null,
        ILogger<AdvanceService>? logger = null)
    {
        _repository = repository;
        _candles = candles;
        _engine = engine ?? new PaperTradingEngine();
        _logger = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<AdvanceService>.Instance;
    }

    public async Task<TradingSession> AdvanceAsync(
        TradingSession session,
        AdvanceSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (request.ToPlayhead < session.Playhead)
        {
            throw new SessionCommandException(
                $"toPlayhead ({request.ToPlayhead}) must be >= current playhead ({session.Playhead}).");
        }

        if (request.ToPlayhead == session.Playhead)
        {
            return session;
        }

        _logger.LogInformation(
            "Advance session {SessionId} to playhead {ToPlayhead}",
            session.Id,
            request.ToPlayhead);

        var jump = request.ToPlayhead - session.Playhead;
        var candleSeries = await SessionSupport.EnsureCandlesCoverPlayheadAsync(
            _candles,
            session,
            request.ToPlayhead,
            cancellationToken);
        if (request.ToPlayhead > candleSeries.Count)
        {
            throw new SessionCommandException(
                $"toPlayhead ({request.ToPlayhead}) exceeds candle count ({candleSeries.Count}).");
        }

        var bars = candleSeries
            .Skip(session.Playhead)
            .Take(jump)
            .Select(SessionSupport.ToOhlc)
            .ToList();

        var lots = session.Lots.ToList();
        var orders = session.PendingOrders.ToList();
        var closed = session.ClosedTrades.ToList();
        var realized = session.RealizedPnl;

        foreach (var bar in bars)
        {
            var balance = session.StartingBalance + realized;
            var matched = _engine.MatchLimits(orders, lots, bar, balance);

            lots = matched.Lots.ToList();
            orders = matched.Orders.ToList();
            if (matched.ClosedTrades.Count > 0)
            {
                closed.AddRange(matched.ClosedTrades);
            }

            realized += matched.RealizedPnlDelta;
        }

        session.Lots = lots;
        session.PendingOrders = orders;
        session.ClosedTrades = closed;
        session.RealizedPnl = realized;
        session.Playhead = request.ToPlayhead;
        session.SessionLocked = true;
        SessionSupport.AdvanceSimClock(session, candleSeries[request.ToPlayhead - 1]);
        session.UpdatedAt = DateTime.UtcNow;
        await _repository.CreateSessionAsync(session, cancellationToken);
        return session;
    }
}
