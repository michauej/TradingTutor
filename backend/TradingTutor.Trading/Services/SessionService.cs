using Microsoft.Extensions.Logging;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.Trading.Services;

/// <summary>
/// Thin facade: session create/get/list/start/lock plus locked delegation to
/// <see cref="TradeCommandService"/>, <see cref="AdvanceService"/>, and
/// <see cref="IntervalReanchorService"/>.
/// </summary>
public class SessionService
{
    private readonly ISessionRepository _repository;
    private readonly ICandleLoadService _candles;
    private readonly SessionCommandLock _commandLock;
    private readonly TradeCommandService _trades;
    private readonly AdvanceService _advance;
    private readonly IntervalReanchorService _reanchor;
    private readonly ILogger<SessionService> _logger;

    public SessionService(
        ISessionRepository repository,
        ICandleLoadService candles,
        TradeCommandService? trades = null,
        AdvanceService? advance = null,
        IntervalReanchorService? reanchor = null,
        SessionCommandLock? commandLock = null,
        PaperTradingEngine? engine = null,
        ILogger<SessionService>? logger = null)
    {
        _repository = repository;
        _candles = candles;
        _commandLock = commandLock ?? new SessionCommandLock();
        var sharedEngine = engine ?? new PaperTradingEngine();
        _trades = trades ?? new TradeCommandService(repository, candles, sharedEngine);
        _advance = advance ?? new AdvanceService(repository, candles, sharedEngine);
        _reanchor = reanchor ?? new IntervalReanchorService(repository, candles);
        _logger = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<SessionService>.Instance;
    }

    /// <summary>Legacy upsert by client id — retained for tests; prefer <see cref="StartAsync"/>.</summary>
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

    /// <summary>Create a server-owned session with empty lots/orders/trades.</summary>
    public async Task<TradingSession> StartAsync(
        StartSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (string.IsNullOrWhiteSpace(request.Symbol))
        {
            throw new SessionCommandException("Symbol is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Interval))
        {
            throw new SessionCommandException("Interval is required.");
        }

        if (request.RangeStart is null || request.RangeEnd is null)
        {
            throw new SessionCommandException("RangeStart and RangeEnd are required.");
        }

        if (request.StartingBalance < 0)
        {
            throw new SessionCommandException("StartingBalance must be non-negative.");
        }

        if (request.Playhead < 0)
        {
            throw new SessionCommandException("Playhead must be non-negative.");
        }

        var now = DateTime.UtcNow;
        var session = new TradingSession
        {
            Id = Guid.NewGuid().ToString("D"),
            CreatedAt = now,
            UpdatedAt = now,
            Symbol = request.Symbol.Trim().ToUpperInvariant(),
            Exchange = string.IsNullOrWhiteSpace(request.Exchange) ? "ByBit" : request.Exchange.Trim(),
            Interval = request.Interval.Trim(),
            RangeStart = DateTime.SpecifyKind(request.RangeStart.Value, DateTimeKind.Utc),
            RangeEnd = DateTime.SpecifyKind(request.RangeEnd.Value, DateTimeKind.Utc),
            SessionStartDate = request.SessionStartDate?.Trim() ?? string.Empty,
            Playhead = request.Playhead,
            SessionLocked = true,
            StartingBalance = request.StartingBalance,
            RealizedPnl = 0m,
            Lots = [],
            PendingOrders = [],
            ClosedTrades = []
        };

        session.ActivePackStart = session.RangeStart;
        session.ActivePackEnd = session.RangeEnd;
        await SessionSupport.SeedSimClockAsync(_candles, session, cancellationToken);
        await _repository.CreateSessionAsync(session, cancellationToken);
        _logger.LogInformation("Started session {SessionId} for {Symbol} {Interval}", session.Id, session.Symbol, session.Interval);
        return session;
    }

    public Task<TradingSession> LockAsync(string id, CancellationToken cancellationToken = default) =>
        WithSessionLockAsync(id, async (session, ct) =>
        {
            session.SessionLocked = true;
            session.UpdatedAt = DateTime.UtcNow;
            await _repository.CreateSessionAsync(session, ct);
            return session;
        }, cancellationToken);

    public Task<TradingSession> AdvanceAsync(
        string id,
        AdvanceSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(
            id,
            (session, ct) => _advance.AdvanceAsync(session, request, ct),
            cancellationToken);
    }

    public Task<TradingSession> ReanchorIntervalAsync(
        string id,
        ReanchorIntervalRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(
            id,
            (session, ct) => _reanchor.ReanchorIntervalAsync(session, request, ct),
            cancellationToken);
    }

    public Task<TradingSession> OpenAsync(
        string id,
        OpenSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(
            id,
            (session, ct) => _trades.OpenAsync(session, request, ct),
            cancellationToken);
    }

    public Task<TradingSession> CloseAsync(
        string id,
        CloseSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(
            id,
            (session, ct) => _trades.CloseAsync(session, request, ct),
            cancellationToken);
    }

    public Task<TradingSession> PlaceOrderAsync(
        string id,
        PlaceOrderRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(
            id,
            (session, ct) => _trades.PlaceOrderAsync(session, request, ct),
            cancellationToken);
    }

    public Task<TradingSession> CancelOrderAsync(
        string id,
        string orderId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(orderId);
        return WithSessionLockAsync(
            id,
            (session, ct) => _trades.CancelOrderAsync(session, orderId, ct),
            cancellationToken);
    }

    private async Task<TradingSession> WithSessionLockAsync(
        string id,
        Func<TradingSession, CancellationToken, Task<TradingSession>> action,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        var gate = _commandLock.GetGate(id);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var session = await _repository.GetSessionAsync(id, cancellationToken)
                ?? throw new SessionNotFoundException(id);
            return await action(session, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    // Thin wrappers so existing tests keep calling SessionService.* statics.
    internal static readonly TimeSpan TipWindowMinDays = SessionSupport.TipWindowMinDays;
    internal const int TipWindowMinBars = SessionSupport.TipWindowMinBars;

    internal static TimeSpan TipWindowPadForInterval(string interval) =>
        SessionSupport.TipWindowPadForInterval(interval);

    internal static (DateTime Start, DateTime End) TipWindowBounds(
        DateTime watermark,
        DateTime rangeStart,
        DateTime rangeEnd,
        string interval) =>
        SessionSupport.TipWindowBounds(watermark, rangeStart, rangeEnd, interval);

    internal static bool SeriesCoversWatermark(
        IReadOnlyList<MarketData> candles,
        DateTime watermark,
        string interval) =>
        SessionSupport.SeriesCoversWatermark(candles, watermark, interval);

    internal static int PlayheadForWatermark(
        IReadOnlyList<MarketData> candles,
        DateTime watermark,
        string interval) =>
        SessionSupport.PlayheadForWatermark(candles, watermark, interval);
}
