using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.Trading.Services;

/// <summary>
/// Session create/get/list plus authoritative trade/advance commands.
/// Commands load candle OHLC from packs and mutate via <see cref="PaperTradingEngine"/>.
/// </summary>
public class SessionService
{
    private readonly ISessionRepository _repository;
    private readonly ICandleLoadService _candles;
    private readonly PaperTradingEngine _engine;
    private readonly SessionCommandLock _commandLock;

    public SessionService(
        ISessionRepository repository,
        ICandleLoadService candles,
        SessionCommandLock? commandLock = null,
        PaperTradingEngine? engine = null)
    {
        _repository = repository;
        _candles = candles;
        _commandLock = commandLock ?? new SessionCommandLock();
        _engine = engine ?? new PaperTradingEngine();
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
            // Locked on Start so /trade can open; Play still starts playback only.
            SessionLocked = true,
            StartingBalance = request.StartingBalance,
            RealizedPnl = 0m,
            Lots = [],
            PendingOrders = [],
            ClosedTrades = []
        };

        session.ActivePackStart = session.RangeStart;
        session.ActivePackEnd = session.RangeEnd;
        await SeedSimClockAsync(session, cancellationToken);
        await _repository.CreateSessionAsync(session, cancellationToken);
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
        return WithSessionLockAsync(id, async (session, ct) =>
        {
            if (request.ToPlayhead < session.Playhead)
            {
                throw new SessionCommandException(
                    $"toPlayhead ({request.ToPlayhead}) must be >= current playhead ({session.Playhead}).");
            }

            if (request.ToPlayhead == session.Playhead)
            {
                return session;
            }

            // Money math uses server packs only — ignore any client-supplied Bars.
            var jump = request.ToPlayhead - session.Playhead;
            var candles = await EnsureCandlesCoverPlayheadAsync(
                session,
                request.ToPlayhead,
                ct);
            if (request.ToPlayhead > candles.Count)
            {
                throw new SessionCommandException(
                    $"toPlayhead ({request.ToPlayhead}) exceeds candle count ({candles.Count}).");
            }

            var bars = candles
                .Skip(session.Playhead)
                .Take(jump)
                .Select(ToOhlc)
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
            AdvanceSimClock(session, candles[request.ToPlayhead - 1]);
            session.UpdatedAt = DateTime.UtcNow;
            await _repository.CreateSessionAsync(session, ct);
            return session;
        }, cancellationToken);
    }

    /// <summary>
    /// Switch execution interval. Remaps playhead by sim watermark (closed bars only
    /// when the tip falls inside a forming bar). Keeps lots/orders; does not fill.
    /// </summary>
    public Task<TradingSession> ReanchorIntervalAsync(
        string id,
        ReanchorIntervalRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(id, async (session, ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Interval))
            {
                throw new SessionCommandException("Interval is required.");
            }

            var nextInterval = request.Interval.Trim();
            if (string.Equals(session.Interval, nextInterval, StringComparison.OrdinalIgnoreCase))
            {
                return session;
            }

            var watermark = session.SimWatermark;
            session.Interval = nextInterval;

            // Tip±pad active pack so playhead indices match the FE tip window.
            // Pad = max(2 days, 500 bars) — LTF stays tight; HTF keeps chart history.
            if (watermark is not null &&
                session.RangeStart is not null &&
                session.RangeEnd is not null)
            {
                var (packStart, packEnd) = TipWindowBounds(
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

            var candles = await LoadSessionCandlesAsync(session, ct);

            if (watermark is null)
            {
                session.Playhead = 0;
            }
            else
            {
                if (!SeriesCoversWatermark(candles, watermark.Value, nextInterval))
                {
                    throw new SessionCommandException(
                        $"Interval {nextInterval} has no candles covering sim tip {watermark:o}. " +
                        "Stay on a higher TF or load a wider From–To range.");
                }

                session.Playhead = PlayheadForWatermark(
                    candles,
                    watermark.Value,
                    nextInterval);
                if (session.SimWatermark is null || watermark.Value > session.SimWatermark)
                {
                    session.SimWatermark = watermark;
                }
            }

            // Keep SimMarkPrice/Time — tip price must not jump to a forming HTF close.
            session.UpdatedAt = DateTime.UtcNow;
            await _repository.CreateSessionAsync(session, ct);
            return session;
        }, cancellationToken);
    }

    public Task<TradingSession> OpenAsync(
        string id,
        OpenSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(id, async (session, ct) =>
        {
            EnsureLockedForTrade(session);
            var side = RequireSide(request.Side);
            var mark = await ResolveMarkAsync(session, request.MarkPrice, request.MarkTime, ct);
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
            await _repository.CreateSessionAsync(session, ct);
            return session;
        }, cancellationToken);
    }

    public Task<TradingSession> CloseAsync(
        string id,
        CloseSessionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(id, async (session, ct) =>
        {
            EnsureLockedForTrade(session);
            var mark = await ResolveMarkAsync(session, request.MarkPrice, request.MarkTime, ct);
            var mode = (request.Mode ?? string.Empty).Trim().ToLowerInvariant();

            switch (mode)
            {
                case "fifo":
                {
                    var side = RequireSide(request.Side);
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
                    var side = RequireSide(request.Side);
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
            await _repository.CreateSessionAsync(session, ct);
            return session;
        }, cancellationToken);
    }

    public Task<TradingSession> PlaceOrderAsync(
        string id,
        PlaceOrderRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithSessionLockAsync(id, async (session, ct) =>
        {
            EnsureLockedForTrade(session);
            var mark = await ResolveMarkAsync(session, request.MarkPrice, request.MarkTime, ct);
            var side = RequireSide(request.Side);
            var intent = RequireIntent(request.Intent);
            var type = (request.Type ?? "limit").Trim().ToLowerInvariant();

            if (!(request.Qty > 0) || !(request.LimitPrice > 0))
            {
                throw new SessionCommandException("Order qty and limitPrice must be positive.");
            }

            if (intent == "close")
            {
                var available = AvailableQty(session.Lots, side);
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
            await _repository.CreateSessionAsync(session, ct);
            return session;
        }, cancellationToken);
    }

    public Task<TradingSession> CancelOrderAsync(
        string id,
        string orderId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(orderId);
        return WithSessionLockAsync(id, async (session, ct) =>
        {
            var result = PaperTradingEngine.CancelOrder(session.PendingOrders, orderId);
            if (result.Cancelled is null)
            {
                throw new SessionCommandException($"Order {orderId} not found.");
            }

            session.PendingOrders = result.Orders.ToList();
            session.UpdatedAt = DateTime.UtcNow;
            await _repository.CreateSessionAsync(session, ct);
            return session;
        }, cancellationToken);
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

    /// <summary>Matches FE <c>TIP_WINDOW_MIN_DAYS_MS</c>.</summary>
    internal static readonly TimeSpan TipWindowMinDays = TimeSpan.FromDays(2);

    /// <summary>Matches FE <c>TIP_WINDOW_MIN_BARS</c>.</summary>
    internal const int TipWindowMinBars = 500;

    /// <summary>Pad each side: max(2 days, 500 × bar duration). Matches FE tipWindowPadMs.</summary>
    internal static TimeSpan TipWindowPadForInterval(string interval)
    {
        var barMs = IntervalDurationMs(interval);
        var byBars = TimeSpan.FromMilliseconds(barMs * TipWindowMinBars);
        return byBars > TipWindowMinDays ? byBars : TipWindowMinDays;
    }

    /// <summary>Clamp tip±pad into the session From–To range.</summary>
    internal static (DateTime Start, DateTime End) TipWindowBounds(
        DateTime watermark,
        DateTime rangeStart,
        DateTime rangeEnd,
        string interval)
    {
        var tip = DateTime.SpecifyKind(watermark, DateTimeKind.Utc);
        var pad = TipWindowPadForInterval(interval);
        var start = tip - pad;
        var end = tip + pad;
        var rs = DateTime.SpecifyKind(rangeStart, DateTimeKind.Utc);
        var re = DateTime.SpecifyKind(rangeEnd, DateTimeKind.Utc);
        if (start < rs)
        {
            start = rs;
        }

        if (end > re)
        {
            end = re;
        }

        if (start >= end)
        {
            start = rs;
            end = re;
        }

        return (start, end);
    }

    private async Task<IReadOnlyList<MarketData>> LoadSessionCandlesAsync(
        TradingSession session,
        CancellationToken cancellationToken)
    {
        if (session.RangeStart is null || session.RangeEnd is null)
        {
            throw new SessionCommandException("Session is missing candle range references.");
        }

        var packStart = session.ActivePackStart ?? session.RangeStart.Value;
        var packEnd = session.ActivePackEnd ?? session.RangeEnd.Value;

        // Full series for engine/mark (no offset/limit). Progressive pages are FE-only.
        var result = await _candles.LoadAsync(
            session.Symbol,
            session.Interval,
            packStart,
            packEnd,
            refresh: false,
            offset: null,
            limit: null,
            cancellationToken: cancellationToken);

        if (result.Candles.Count == 0)
        {
            throw new SessionCommandException("No candles available for the session range.");
        }

        return result.Candles;
    }

    /// <summary>
    /// Grow ActivePackEnd by tip-window pads until <paramref name="toPlayhead"/> fits,
    /// or the session range end is reached.
    /// </summary>
    private async Task<IReadOnlyList<MarketData>> EnsureCandlesCoverPlayheadAsync(
        TradingSession session,
        int toPlayhead,
        CancellationToken cancellationToken)
    {
        var candles = await LoadSessionCandlesAsync(session, cancellationToken);
        var guard = 0;
        while (toPlayhead > candles.Count && guard < 32)
        {
            guard++;
            if (session.RangeEnd is null || session.ActivePackEnd is null)
            {
                break;
            }

            var rangeEnd = DateTime.SpecifyKind(session.RangeEnd.Value, DateTimeKind.Utc);
            var packEnd = DateTime.SpecifyKind(session.ActivePackEnd.Value, DateTimeKind.Utc);
            if (packEnd >= rangeEnd)
            {
                break;
            }

            var nextEnd = packEnd + TipWindowPadForInterval(session.Interval);
            if (nextEnd > rangeEnd)
            {
                nextEnd = rangeEnd;
            }

            if (nextEnd <= packEnd)
            {
                break;
            }

            session.ActivePackEnd = nextEnd;
            candles = await LoadSessionCandlesAsync(session, cancellationToken);
        }

        return candles;
    }

    internal static bool SeriesCoversWatermark(
        IReadOnlyList<MarketData> candles,
        DateTime watermark,
        string interval)
    {
        if (candles.Count == 0)
        {
            return false;
        }

        var tip = DateTime.SpecifyKind(watermark, DateTimeKind.Utc);
        var first = DateTime.SpecifyKind(candles[0].Timestamp, DateTimeKind.Utc);
        var lastOpen = DateTime.SpecifyKind(candles[^1].Timestamp, DateTimeKind.Utc);
        var lastEnd = lastOpen.AddMilliseconds(IntervalDurationMs(interval));
        return first <= tip && tip < lastEnd;
    }

    private async Task<(decimal MarkPrice, DateTime MarkTime)> ResolveMarkAsync(
        TradingSession session,
        decimal? markPrice,
        DateTime? markTime,
        CancellationToken cancellationToken)
    {
        // Client markPrice/markTime are ignored — sim clock / pack candle is authority.
        _ = markPrice;
        _ = markTime;

        var candles = await LoadSessionCandlesAsync(session, cancellationToken);
        if (session.Playhead <= 0 || session.Playhead > candles.Count)
        {
            throw new SessionCommandException("Cannot trade without a mark candle.");
        }

        var candle = candles[session.Playhead - 1];
        var packTime = DateTime.SpecifyKind(candle.Timestamp, DateTimeKind.Utc);
        var packClose = candle.Close;

        // Prefer sim tip when it is at/after the pack candle (LTF tip after HTF
        // re-anchor). Never use a stale sim mark from behind the current playhead.
        if (session.SimMarkPrice is { } cached && cached > 0 &&
            session.SimMarkTime is { } cachedTime)
        {
            var tipTime = DateTime.SpecifyKind(cachedTime, DateTimeKind.Utc);
            var watermark = session.SimWatermark is { } w
                ? DateTime.SpecifyKind(w, DateTimeKind.Utc)
                : tipTime;
            if (watermark >= packTime)
            {
                // Entry/exit time = sim tip (watermark), not HTF bar open.
                return (cached, watermark);
            }
        }

        return (packClose, packTime);
    }

    private async Task SeedSimClockAsync(TradingSession session, CancellationToken cancellationToken)
    {
        if (session.Playhead <= 0)
        {
            return;
        }

        try
        {
            var candles = await LoadSessionCandlesAsync(session, cancellationToken);
            if (session.Playhead <= candles.Count)
            {
                AdvanceSimClock(session, candles[session.Playhead - 1]);
            }
        }
        catch (SessionCommandException)
        {
            // Range packs may be missing at Start in tests; clock seeds on first advance.
        }
    }

    private static void AdvanceSimClock(TradingSession session, MarketData tipCandle)
    {
        var tip = DateTime.SpecifyKind(tipCandle.Timestamp, DateTimeKind.Utc);
        if (session.SimWatermark is null || tip > session.SimWatermark)
        {
            session.SimWatermark = tip;
        }

        session.SimMarkPrice = tipCandle.Close;
        session.SimMarkTime = tip;
    }

    /// <summary>
    /// Exclusive playhead for the sim watermark on a (possibly different) interval.
    /// Reveals the bar that contains the watermark so HTF switches keep the tip near
    /// the LTF clock (e.g. 07:25 → 07:00 hour) and never yield an empty chart.
    /// Fills still run only on Play/advance — re-anchor itself does not MatchLimits.
    /// </summary>
    internal static int PlayheadForWatermark(
        IReadOnlyList<MarketData> candles,
        DateTime watermark,
        string interval)
    {
        if (candles.Count == 0)
        {
            return 0;
        }

        var target = DateTime.SpecifyKind(watermark, DateTimeKind.Utc);
        var barMs = IntervalDurationMs(interval);

        for (var i = 0; i < candles.Count; i++)
        {
            var open = DateTime.SpecifyKind(candles[i].Timestamp, DateTimeKind.Utc);
            if (open == target)
            {
                return i + 1;
            }

            var end = i + 1 < candles.Count
                ? DateTime.SpecifyKind(candles[i + 1].Timestamp, DateTimeKind.Utc)
                : open.AddMilliseconds(barMs);

            if (open < target && target < end)
            {
                // Include the in-progress HTF bucket so the tip stays on that hour.
                return i + 1;
            }

            if (open > target)
            {
                return i;
            }
        }

        return candles.Count;
    }

    private static double IntervalDurationMs(string interval) =>
        interval.Trim().ToLowerInvariant() switch
        {
            "1" or "1m" => 60_000,
            "5" or "5m" => 5 * 60_000,
            "15" or "15m" => 15 * 60_000,
            "60" or "1h" => 60 * 60_000,
            "240" or "4h" => 4 * 60 * 60_000,
            "d" or "1d" => 24 * 60 * 60_000,
            _ => 60 * 60_000
        };

    private static void EnsureLockedForTrade(TradingSession session)
    {
        if (!session.SessionLocked)
        {
            throw new SessionCommandException("Play once to lock the session before trading.");
        }
    }

    private static string RequireSide(string? side)
    {
        if (string.Equals(side, "long", StringComparison.OrdinalIgnoreCase))
        {
            return "long";
        }

        if (string.Equals(side, "short", StringComparison.OrdinalIgnoreCase))
        {
            return "short";
        }

        throw new SessionCommandException("Side must be long or short.");
    }

    private static string RequireIntent(string? intent)
    {
        if (string.Equals(intent, "open", StringComparison.OrdinalIgnoreCase))
        {
            return "open";
        }

        if (string.Equals(intent, "close", StringComparison.OrdinalIgnoreCase))
        {
            return "close";
        }

        throw new SessionCommandException("Intent must be open or close.");
    }

    private static decimal AvailableQty(IEnumerable<SessionLot> lots, string side) =>
        lots.Where(l => string.Equals(l.Side, side, StringComparison.OrdinalIgnoreCase))
            .Sum(l => l.Qty);

    private static OhlcBar ToOhlc(MarketData candle) =>
        new()
        {
            Open = candle.Open,
            High = candle.High,
            Low = candle.Low,
            Close = candle.Close,
            Timestamp = candle.Timestamp
        };
}
