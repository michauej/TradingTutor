using Microsoft.Extensions.Logging;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.Trading.Services;

/// <summary>Interval switch without fills for a loaded session (lock owned by facade).</summary>
public class IntervalReanchorService
{
    private readonly ISessionRepository _repository;
    private readonly ICandleLoadService _candles;
    private readonly ILogger<IntervalReanchorService> _logger;

    public IntervalReanchorService(
        ISessionRepository repository,
        ICandleLoadService candles,
        ILogger<IntervalReanchorService>? logger = null)
    {
        _repository = repository;
        _candles = candles;
        _logger = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<IntervalReanchorService>.Instance;
    }

    public async Task<TradingSession> ReanchorIntervalAsync(
        TradingSession session,
        ReanchorIntervalRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (string.IsNullOrWhiteSpace(request.Interval))
        {
            throw new SessionCommandException("Interval is required.");
        }

        var nextInterval = request.Interval.Trim();
        // Strict parse — unknown intervals throw CandleLoadValidationException.
        _ = IntervalParser.ToDurationMs(nextInterval);

        if (string.Equals(session.Interval, nextInterval, StringComparison.OrdinalIgnoreCase))
        {
            return session;
        }

        _logger.LogInformation(
            "Reanchor session {SessionId} to interval {Interval}",
            session.Id,
            nextInterval);

        var watermark = session.SimWatermark;
        session.Interval = nextInterval;

        if (watermark is not null &&
            session.RangeStart is not null &&
            session.RangeEnd is not null)
        {
            var (packStart, packEnd) = SessionSupport.TipWindowBounds(
                watermark.Value,
                session.RangeStart.Value,
                session.RangeEnd.Value,
                nextInterval);
            session.ActivePackStart = packStart;
            session.ActivePackEnd = packEnd;
        }
        else
        {
            session.ActivePackStart = session.RangeStart;
            session.ActivePackEnd = session.RangeEnd;
        }

        var candleSeries = await SessionSupport.LoadSessionCandlesAsync(_candles, session, cancellationToken);

        if (watermark is null)
        {
            session.Playhead = 0;
        }
        else
        {
            if (!SessionSupport.SeriesCoversWatermark(candleSeries, watermark.Value, nextInterval))
            {
                throw new SessionCommandException(
                    $"Interval {nextInterval} has no candles covering sim tip {watermark:o}. " +
                    "Stay on a higher TF or load a wider From–To range.");
            }

            session.Playhead = SessionSupport.PlayheadForWatermark(
                candleSeries,
                watermark.Value,
                nextInterval);
            if (session.SimWatermark is null || watermark.Value > session.SimWatermark)
            {
                session.SimWatermark = watermark;
            }
        }

        session.UpdatedAt = DateTime.UtcNow;
        await _repository.CreateSessionAsync(session, cancellationToken);
        return session;
    }
}
