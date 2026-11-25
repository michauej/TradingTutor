using TradingTutor.Core.Models;

namespace TradingTutor.Trading.Services;

/// <summary>
/// Pure paper-trading math ported from <c>frontend/src/trading/trading.ts</c>.
/// Soft-cap, PnL, open/close FIFO, close-all/qty, limit/stop place/cancel, and MatchLimits.
/// </summary>
public sealed class PaperTradingEngine
{
    private const decimal QtyEpsilon = 1e-12m;

    private int _idSeq;
    private readonly Func<string>? _idFactory;

    /// <param name="idFactory">
    /// Optional id factory for tests. When null, uses an internal sequence (<c>prefix-N</c>).
    /// </param>
    public PaperTradingEngine(Func<string>? idFactory = null)
    {
        _idFactory = idFactory;
    }

    public string NextTradingId(string prefix = "t")
    {
        if (_idFactory is not null)
        {
            return _idFactory();
        }

        _idSeq++;
        return $"{prefix}-{_idSeq}";
    }

    public void ResetIdSeq() => _idSeq = 0;

    public static decimal AccountBalance(PaperAccount account) =>
        account.StartingBalance + account.RealizedPnl;

    /// <summary>
    /// Convert a percent-of-wallet sizing input into qty at <paramref name="markPrice"/>.
    /// Rejects non-positive percent / mark / balance and soft-cap failures.
    /// </summary>
    public static SizingResult QtyFromPercent(decimal balance, decimal percent, decimal markPrice)
    {
        if (!(balance > 0) || !(percent > 0) || !(markPrice > 0))
        {
            return new SizingResult.Reject(
                "invalid",
                "Balance, percent, and mark price must be positive");
        }

        var notional = balance * (percent / 100m);
        var qty = notional / markPrice;
        return ValidateQtyAgainstSoftCap(qty, markPrice, balance);
    }

    /// <summary>Accept raw qty if positive and within soft notional cap vs balance.</summary>
    public static SizingResult ValidateQtyAgainstSoftCap(
        decimal qty,
        decimal markPrice,
        decimal balance)
    {
        if (!(qty > 0) || !(markPrice > 0))
        {
            return new SizingResult.Reject("invalid", "Qty and mark price must be positive");
        }

        if (!(balance >= 0))
        {
            return new SizingResult.Reject("invalid", "Balance must be non-negative");
        }

        var notional = qty * markPrice;
        if (notional > balance)
        {
            return new SizingResult.Reject(
                "softCapExceeded",
                $"Order notional {notional} exceeds balance {balance}");
        }

        return new SizingResult.Accept(qty);
    }

    /// <summary>Realized PnL for a closed lot (1x paper).</summary>
    public static decimal RealizedPnl(
        string side,
        decimal qty,
        decimal entryPrice,
        decimal exitPrice)
    {
        if (IsLong(side))
        {
            return (exitPrice - entryPrice) * qty;
        }

        return (entryPrice - exitPrice) * qty;
    }

    /// <summary>Net Long / Short aggregates from hidden lots (qty-weighted avg entry).</summary>
    public static (NetSide Long, NetSide Short) NetSides(IReadOnlyList<SessionLot> lots) =>
        (AggregateSide(lots, "long"), AggregateSide(lots, "short"));

    private static NetSide AggregateSide(IReadOnlyList<SessionLot> lots, string side)
    {
        decimal qty = 0;
        decimal cost = 0;
        foreach (var lot in lots)
        {
            if (!string.Equals(lot.Side, side, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            qty += lot.Qty;
            cost += lot.Qty * lot.EntryPrice;
        }

        return new NetSide
        {
            Qty = qty,
            AvgEntry = qty > 0 ? cost / qty : 0
        };
    }

    /// <summary>Append a lot at mark price after soft-cap check.</summary>
    public OpenMarketResult OpenMarket(
        IReadOnlyList<SessionLot> lots,
        string side,
        decimal qty,
        decimal markPrice,
        DateTime markTime,
        decimal balance,
        string? id = null)
    {
        var sized = ValidateQtyAgainstSoftCap(qty, markPrice, balance);
        if (sized is SizingResult.Reject reject)
        {
            return new OpenMarketResult.Failure(reject.Reason, reject.Message);
        }

        var accept = (SizingResult.Accept)sized;
        var lot = new SessionLot
        {
            Id = id ?? NextTradingId("lot"),
            Side = NormalizeSide(side),
            Qty = accept.Qty,
            EntryPrice = markPrice,
            EntryTime = markTime
        };

        var nextLots = new List<SessionLot>(lots.Count + 1);
        nextLots.AddRange(lots);
        nextLots.Add(lot);
        return new OpenMarketResult.Success(nextLots, lot);
    }

    /// <summary>Close the oldest full lot on <paramref name="side"/> at market (FIFO).</summary>
    public CloseMarketResult CloseMarketFifo(
        IReadOnlyList<SessionLot> lots,
        string side,
        decimal exitPrice,
        DateTime exitTime,
        string? tradeId = null)
    {
        var index = IndexOfSide(lots, side);
        if (index < 0)
        {
            return new CloseMarketResult.Failure(
                "flat",
                $"No {NormalizeSide(side)} lots to close");
        }

        var lot = lots[index];
        var pnl = RealizedPnl(lot.Side, lot.Qty, lot.EntryPrice, exitPrice);
        var closedTrade = new ClosedTradeInput
        {
            Id = tradeId ?? NextTradingId("trade"),
            Side = lot.Side,
            Qty = lot.Qty,
            EntryPrice = lot.EntryPrice,
            EntryTime = lot.EntryTime,
            ExitPrice = exitPrice,
            ExitTime = exitTime,
            RealizedPnl = pnl
        };

        var nextLots = new List<SessionLot>(lots.Count - 1);
        for (var i = 0; i < lots.Count; i++)
        {
            if (i != index)
            {
                nextLots.Add(lots[i]);
            }
        }

        return new CloseMarketResult.Success(nextLots, closedTrade, pnl);
    }

    /// <summary>Close a specific open lot at market (used by Open trades → Close).</summary>
    public CloseMarketResult CloseLotById(
        IReadOnlyList<SessionLot> lots,
        string lotId,
        decimal exitPrice,
        DateTime exitTime,
        string? tradeId = null)
    {
        var index = -1;
        for (var i = 0; i < lots.Count; i++)
        {
            if (lots[i].Id == lotId)
            {
                index = i;
                break;
            }
        }

        if (index < 0)
        {
            return new CloseMarketResult.Failure("flat", $"Lot {lotId} not found");
        }

        var lot = lots[index];
        var pnl = RealizedPnl(lot.Side, lot.Qty, lot.EntryPrice, exitPrice);
        var closedTrade = new ClosedTradeInput
        {
            Id = tradeId ?? NextTradingId("trade"),
            Side = lot.Side,
            Qty = lot.Qty,
            EntryPrice = lot.EntryPrice,
            EntryTime = lot.EntryTime,
            ExitPrice = exitPrice,
            ExitTime = exitTime,
            RealizedPnl = pnl
        };

        var nextLots = new List<SessionLot>(lots.Count - 1);
        for (var i = 0; i < lots.Count; i++)
        {
            if (i != index)
            {
                nextLots.Add(lots[i]);
            }
        }

        return new CloseMarketResult.Success(nextLots, closedTrade, pnl);
    }

    /// <summary>Flatten every lot on both sides at market.</summary>
    public CloseAllResult CloseAll(
        IReadOnlyList<SessionLot> lots,
        decimal exitPrice,
        DateTime exitTime,
        Func<string>? idFactory = null)
    {
        var closedTrades = new List<ClosedTradeInput>(lots.Count);
        decimal pnlSum = 0;
        var nextId = idFactory ?? (() => NextTradingId("trade"));

        foreach (var lot in lots)
        {
            var pnl = RealizedPnl(lot.Side, lot.Qty, lot.EntryPrice, exitPrice);
            pnlSum += pnl;
            closedTrades.Add(new ClosedTradeInput
            {
                Id = nextId(),
                Side = lot.Side,
                Qty = lot.Qty,
                EntryPrice = lot.EntryPrice,
                EntryTime = lot.EntryTime,
                ExitPrice = exitPrice,
                ExitTime = exitTime,
                RealizedPnl = pnl
            });
        }

        return new CloseAllResult
        {
            Lots = Array.Empty<SessionLot>(),
            ClosedTrades = closedTrades,
            RealizedPnl = pnlSum
        };
    }

    /// <summary>
    /// Close up to <paramref name="qty"/> on <paramref name="side"/> consuming oldest lots FIFO
    /// (may partially reduce a lot). Used when a close limit fills for a free-form qty.
    /// </summary>
    public CloseQtyResult CloseQtyFifo(
        IReadOnlyList<SessionLot> lots,
        string side,
        decimal qty,
        decimal exitPrice,
        DateTime exitTime,
        Func<string>? idFactory = null)
    {
        if (!(qty > 0))
        {
            return new CloseQtyResult.Failure("insufficient", "Close qty must be positive");
        }

        var normalized = NormalizeSide(side);
        decimal available = 0;
        foreach (var lot in lots)
        {
            if (string.Equals(lot.Side, normalized, StringComparison.OrdinalIgnoreCase))
            {
                available += lot.Qty;
            }
        }

        if (available + QtyEpsilon < qty)
        {
            return new CloseQtyResult.Failure(
                "insufficient",
                $"Insufficient {normalized} qty to close {qty}");
        }

        var nextId = idFactory ?? (() => NextTradingId("trade"));
        var nextLots = new List<SessionLot>();
        var closedTrades = new List<ClosedTradeInput>();
        var remaining = qty;
        decimal pnlSum = 0;

        foreach (var lot in lots)
        {
            if (!string.Equals(lot.Side, normalized, StringComparison.OrdinalIgnoreCase)
                || remaining <= 0)
            {
                nextLots.Add(lot);
                continue;
            }

            var take = Math.Min(lot.Qty, remaining);
            var pnl = RealizedPnl(lot.Side, take, lot.EntryPrice, exitPrice);
            pnlSum += pnl;
            closedTrades.Add(new ClosedTradeInput
            {
                Id = nextId(),
                Side = lot.Side,
                Qty = take,
                EntryPrice = lot.EntryPrice,
                EntryTime = lot.EntryTime,
                ExitPrice = exitPrice,
                ExitTime = exitTime,
                RealizedPnl = pnl
            });
            remaining -= take;
            var leftover = lot.Qty - take;
            if (leftover > QtyEpsilon)
            {
                nextLots.Add(new SessionLot
                {
                    Id = lot.Id,
                    Side = lot.Side,
                    Qty = leftover,
                    EntryPrice = lot.EntryPrice,
                    EntryTime = lot.EntryTime
                });
            }
        }

        return new CloseQtyResult.Success(nextLots, closedTrades, pnlSum);
    }

    public static CancelOrderResult CancelOrder(IReadOnlyList<SessionOrder> orders, string orderId)
    {
        var index = -1;
        for (var i = 0; i < orders.Count; i++)
        {
            if (orders[i].Id == orderId)
            {
                index = i;
                break;
            }
        }

        if (index < 0)
        {
            return new CancelOrderResult
            {
                Orders = orders.ToList(),
                Cancelled = null
            };
        }

        var cancelled = orders[index];
        var remaining = new List<SessionOrder>(orders.Count - 1);
        for (var i = 0; i < orders.Count; i++)
        {
            if (i != index)
            {
                remaining.Add(orders[i]);
            }
        }

        return new CancelOrderResult { Orders = remaining, Cancelled = cancelled };
    }

    public static IReadOnlyList<SessionOrder> PlaceLimitOrder(
        IReadOnlyList<SessionOrder> orders,
        SessionOrder order)
    {
        var next = CloneOrder(order, type: "limit");
        var list = new List<SessionOrder>(orders.Count + 1);
        list.AddRange(orders);
        list.Add(next);
        return list;
    }

    /// <summary>Resting stop-loss (close) or stop entry; trigger price stored in <c>LimitPrice</c>.</summary>
    public static IReadOnlyList<SessionOrder> PlaceStopOrder(
        IReadOnlyList<SessionOrder> orders,
        SessionOrder order)
    {
        var next = CloneOrder(order, type: "stop");
        var list = new List<SessionOrder>(orders.Count + 1);
        list.AddRange(orders);
        list.Add(next);
        return list;
    }

    /// <summary>
    /// Match resting limit (TP) and stop (SL) orders against a newly revealed bar.
    /// Fill price = trigger; full qty only. Soft-cap failure on open cancels without mutating lots.
    /// </summary>
    public MatchLimitsResult MatchLimits(
        IReadOnlyList<SessionOrder> orders,
        IReadOnlyList<SessionLot> lots,
        OhlcBar bar,
        decimal balance,
        decimal realizedPnl = 0,
        Func<string>? idFactory = null)
    {
        // realizedPnl param kept for API parity with FE; soft-cap uses runningBalance.
        _ = realizedPnl;

        var nextId = idFactory ?? (() => NextTradingId("x"));
        var workingLots = lots.ToList();
        var runningBalance = balance;
        decimal realizedPnlDelta = 0;
        var remaining = new List<SessionOrder>();
        var cancelled = new List<CancelledOrder>();
        var filled = new List<SessionOrder>();
        var closedTrades = new List<ClosedTradeInput>();

        foreach (var order in orders)
        {
            var isResting = IsLimit(order.Type) || IsStop(order.Type);
            if (!isResting || !IsTouched(order, bar))
            {
                remaining.Add(order);
                continue;
            }

            var fillPrice = order.LimitPrice!.Value;
            var fillTime = bar.Timestamp;

            if (IsOpenIntent(order.Intent))
            {
                var sized = ValidateQtyAgainstSoftCap(order.Qty, fillPrice, runningBalance);
                if (sized is SizingResult.Reject reject)
                {
                    if (reject.Reason == "softCapExceeded")
                    {
                        cancelled.Add(new CancelledOrder
                        {
                            Order = order,
                            Reason = "softCapExceeded"
                        });
                        continue;
                    }

                    // Invalid resting order — leave on book.
                    remaining.Add(order);
                    continue;
                }

                var accept = (SizingResult.Accept)sized;
                workingLots.Add(new SessionLot
                {
                    Id = nextId(),
                    Side = NormalizeSide(order.Side),
                    Qty = accept.Qty,
                    EntryPrice = fillPrice,
                    EntryTime = fillTime
                });
                filled.Add(order);
                continue;
            }

            // close (take-profit limit or stop-loss)
            var closed = CloseQtyFifo(
                workingLots,
                order.Side,
                order.Qty,
                fillPrice,
                fillTime,
                nextId);

            if (closed is CloseQtyResult.Failure)
            {
                // Cannot fill — leave resting (insufficient exposure).
                remaining.Add(order);
                continue;
            }

            var success = (CloseQtyResult.Success)closed;
            workingLots = success.Lots.ToList();
            closedTrades.AddRange(success.ClosedTrades);
            realizedPnlDelta += success.RealizedPnl;
            runningBalance += success.RealizedPnl;
            filled.Add(order);
        }

        return new MatchLimitsResult
        {
            Orders = remaining,
            Lots = workingLots,
            ClosedTrades = closedTrades,
            RealizedPnlDelta = realizedPnlDelta,
            Cancelled = cancelled,
            Filled = filled
        };
    }

    /// <summary>Last visible candle close + timestamp for market fills.</summary>
    public static (decimal MarkPrice, DateTime MarkTime)? MarkFromCandles(
        IReadOnlyList<(decimal Close, DateTime Timestamp)> candles)
    {
        if (candles.Count == 0)
        {
            return null;
        }

        var last = candles[^1];
        return (last.Close, last.Timestamp);
    }

    private static bool IsTouched(SessionOrder order, OhlcBar bar)
    {
        var trigger = order.LimitPrice;
        if (trigger is null || !(trigger > 0))
        {
            return false;
        }

        var t = trigger.Value;

        // Take-profit / limit open: buy below / sell above.
        if (IsLimit(order.Type))
        {
            if (IsOpenIntent(order.Intent))
            {
                if (IsLong(order.Side))
                {
                    return bar.Low <= t;
                }

                return bar.High >= t;
            }

            // close = take profit
            if (IsLong(order.Side))
            {
                return bar.High >= t;
            }

            return bar.Low <= t;
        }

        // Stop-loss / stop: adverse touch.
        if (IsStop(order.Type))
        {
            if (IsOpenIntent(order.Intent))
            {
                if (IsLong(order.Side))
                {
                    return bar.High >= t;
                }

                return bar.Low <= t;
            }

            // close = stop loss
            if (IsLong(order.Side))
            {
                return bar.Low <= t;
            }

            return bar.High >= t;
        }

        return false;
    }

    private static int IndexOfSide(IReadOnlyList<SessionLot> lots, string side)
    {
        var normalized = NormalizeSide(side);
        for (var i = 0; i < lots.Count; i++)
        {
            if (string.Equals(lots[i].Side, normalized, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
    }

    private static SessionOrder CloneOrder(SessionOrder order, string type) =>
        new()
        {
            Id = order.Id,
            Side = NormalizeSide(order.Side),
            Intent = NormalizeIntent(order.Intent),
            Type = type,
            Qty = order.Qty,
            LimitPrice = order.LimitPrice,
            CreatedAt = order.CreatedAt
        };

    private static string NormalizeSide(string side) =>
        IsLong(side) ? "long" : "short";

    private static string NormalizeIntent(string intent) =>
        IsOpenIntent(intent) ? "open" : "close";

    private static bool IsLong(string side) =>
        string.Equals(side, "long", StringComparison.OrdinalIgnoreCase);

    private static bool IsOpenIntent(string intent) =>
        string.Equals(intent, "open", StringComparison.OrdinalIgnoreCase);

    private static bool IsLimit(string type) =>
        string.Equals(type, "limit", StringComparison.OrdinalIgnoreCase);

    private static bool IsStop(string type) =>
        string.Equals(type, "stop", StringComparison.OrdinalIgnoreCase);
}
