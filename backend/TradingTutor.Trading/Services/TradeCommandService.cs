using Microsoft.Extensions.Logging;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.Trading.Services;

/// <summary>Open / close / place / cancel bodies for a loaded session (lock owned by facade).</summary>
public class TradeCommandService
{
    private readonly ISessionRepository _repository;
    private readonly ICandleLoadService _candles;
    private readonly PaperTradingEngine _engine;
    private readonly ILogger<TradeCommandService> _logger;

    public TradeCommandService(
        ISessionRepository repository,
        ICandleLoadService candles,
        PaperTradingEngine? engine = null,
        ILogger<TradeCommandService>? logger = null)
    {
        _repository = repository;
        _candles = candles;
        _engine = engine ?? new PaperTradingEngine();
        _logger = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<TradeCommandService>.Instance;
    }

    public async Task<TradingSession> OpenAsync(
        TradingSession session,
        OpenSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        _logger.LogInformation("Open command for session {SessionId}", session.Id);
        SessionSupport.EnsureLockedForTrade(session);
        var side = SessionSupport.RequireSide(request.Side);
        var mark = await SessionSupport.ResolveMarkAsync(
            _candles, session, request.MarkPrice, request.MarkTime, cancellationToken);
        var balance = session.StartingBalance + session.RealizedPnl;

        decimal qty;
        if (request.Qty is { } rawQty)
        {
            qty = rawQty;
        }
        else if (request.Percent is { } percent)
        {
            var sized = PaperTradingEngine.QtyFromPercent(balance, percent, mark.MarkPrice);
            if (sized is SizingResult.Reject reject)
            {
                throw new SessionCommandException(reject.Message);
            }

            qty = ((SizingResult.Accept)sized).Qty;
        }
        else
        {
            throw new SessionCommandException("Open requires qty or percent.");
        }

        var opened = _engine.OpenMarket(
            session.Lots,
            side,
            qty,
            mark.MarkPrice,
            mark.MarkTime,
            balance);

        if (opened is OpenMarketResult.Failure failure)
        {
            throw new SessionCommandException(failure.Message);
        }

        var success = (OpenMarketResult.Success)opened;
        session.Lots = success.Lots.ToList();
        session.UpdatedAt = DateTime.UtcNow;
        await _repository.CreateSessionAsync(session, cancellationToken);
        return session;
    }

    public async Task<TradingSession> CloseAsync(
        TradingSession session,
        CloseSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        _logger.LogInformation("Close command for session {SessionId} mode {Mode}", session.Id, request.Mode);
        SessionSupport.EnsureLockedForTrade(session);
        var mark = await SessionSupport.ResolveMarkAsync(
            _candles, session, request.MarkPrice, request.MarkTime, cancellationToken);
        var mode = (request.Mode ?? string.Empty).Trim().ToLowerInvariant();

        switch (mode)
        {
            case "fifo":
            {
                var side = SessionSupport.RequireSide(request.Side);
                var closed = _engine.CloseMarketFifo(
                    session.Lots,
                    side,
                    mark.MarkPrice,
                    mark.MarkTime);
                if (closed is CloseMarketResult.Failure failure)
                {
                    throw new SessionCommandException(failure.Message);
                }

                var ok = (CloseMarketResult.Success)closed;
                session.Lots = ok.Lots.ToList();
                session.ClosedTrades.Add(ok.ClosedTrade);
                session.RealizedPnl += ok.RealizedPnl;
                break;
            }
            case "lotid":
            case "lot":
            {
                if (string.IsNullOrWhiteSpace(request.LotId))
                {
                    throw new SessionCommandException("lotId is required for lotId close mode.");
                }

                var closed = _engine.CloseLotById(
                    session.Lots,
                    request.LotId,
                    mark.MarkPrice,
                    mark.MarkTime);
                if (closed is CloseMarketResult.Failure failure)
                {
                    throw new SessionCommandException(failure.Message);
                }

                var ok = (CloseMarketResult.Success)closed;
                session.Lots = ok.Lots.ToList();
                session.ClosedTrades.Add(ok.ClosedTrade);
                session.RealizedPnl += ok.RealizedPnl;
                break;
            }
            case "qty":
            {
                var side = SessionSupport.RequireSide(request.Side);
                if (request.Qty is not { } qty || !(qty > 0))
                {
                    throw new SessionCommandException("qty must be positive for qty close mode.");
                }

                var closed = _engine.CloseQtyFifo(
                    session.Lots,
                    side,
                    qty,
                    mark.MarkPrice,
                    mark.MarkTime);
                if (closed is CloseQtyResult.Failure failure)
                {
                    throw new SessionCommandException(failure.Message);
                }

                var ok = (CloseQtyResult.Success)closed;
                session.Lots = ok.Lots.ToList();
                session.ClosedTrades.AddRange(ok.ClosedTrades);
                session.RealizedPnl += ok.RealizedPnl;
                break;
            }
            case "all":
            {
                if (session.Lots.Count == 0)
                {
                    throw new SessionCommandException("Already flat — nothing to close.");
                }

                var flattened = _engine.CloseAll(
                    session.Lots,
                    mark.MarkPrice,
                    mark.MarkTime);
                session.Lots = flattened.Lots.ToList();
                session.ClosedTrades.AddRange(flattened.ClosedTrades);
                session.RealizedPnl += flattened.RealizedPnl;
                break;
            }
            default:
                throw new SessionCommandException(
                    "Close mode must be one of: fifo, lotId, qty, all.");
        }

        session.UpdatedAt = DateTime.UtcNow;
        await _repository.CreateSessionAsync(session, cancellationToken);
        return session;
    }

    public async Task<TradingSession> PlaceOrderAsync(
        TradingSession session,
        PlaceOrderRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        _logger.LogInformation("Place order for session {SessionId}", session.Id);
        SessionSupport.EnsureLockedForTrade(session);
        var mark = await SessionSupport.ResolveMarkAsync(
            _candles, session, request.MarkPrice, request.MarkTime, cancellationToken);
        var side = SessionSupport.RequireSide(request.Side);
        var intent = SessionSupport.RequireIntent(request.Intent);
        var type = (request.Type ?? "limit").Trim().ToLowerInvariant();

        if (!(request.Qty > 0) || !(request.LimitPrice > 0))
        {
            throw new SessionCommandException("Order qty and limitPrice must be positive.");
        }

        if (intent == "close")
        {
            var available = SessionSupport.AvailableQty(session.Lots, side);
            if (request.Qty > available + 1e-12m)
            {
                throw new SessionCommandException($"Order qty exceeds {side} net.");
            }
        }
        else if (intent == "open" && type == "limit")
        {
            var balance = session.StartingBalance + session.RealizedPnl;
            var sized = PaperTradingEngine.ValidateQtyAgainstSoftCap(
                request.Qty,
                request.LimitPrice,
                balance);
            if (sized is SizingResult.Reject reject)
            {
                throw new SessionCommandException(reject.Message);
            }
        }

        var order = new SessionOrder
        {
            Id = _engine.NextTradingId("ord"),
            Side = side,
            Intent = intent,
            Type = type is "stop" or "limit" ? type : throw new SessionCommandException(
                "Order type must be limit or stop."),
            Qty = request.Qty,
            LimitPrice = request.LimitPrice,
            CreatedAt = mark.MarkTime
        };

        session.PendingOrders = type == "stop"
            ? PaperTradingEngine.PlaceStopOrder(session.PendingOrders, order).ToList()
            : PaperTradingEngine.PlaceLimitOrder(session.PendingOrders, order).ToList();

        session.UpdatedAt = DateTime.UtcNow;
        await _repository.CreateSessionAsync(session, cancellationToken);
        return session;
    }

    public async Task<TradingSession> CancelOrderAsync(
        TradingSession session,
        string orderId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentException.ThrowIfNullOrWhiteSpace(orderId);

        _logger.LogInformation("Cancel order {OrderId} for session {SessionId}", orderId, session.Id);
        var result = PaperTradingEngine.CancelOrder(session.PendingOrders, orderId);
        if (result.Cancelled is null)
        {
            throw new SessionCommandException($"Order {orderId} not found.");
        }

        session.PendingOrders = result.Orders.ToList();
        session.UpdatedAt = DateTime.UtcNow;
        await _repository.CreateSessionAsync(session, cancellationToken);
        return session;
    }
}
