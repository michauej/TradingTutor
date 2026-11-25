using TradingTutor.Core.Models;

namespace TradingTutor.Trading.Services;

/// <summary>OHLC bar used for limit/stop touch matching (mirrors frontend OhlcBar).</summary>
public sealed class OhlcBar
{
    public decimal Open { get; init; }
    public decimal High { get; init; }
    public decimal Low { get; init; }
    public decimal Close { get; init; }
    public DateTime Timestamp { get; init; }
}

/// <summary>Paper account: balance = starting + realized.</summary>
public sealed class PaperAccount
{
    public decimal StartingBalance { get; init; }
    public decimal RealizedPnl { get; init; }
}

/// <summary>Net Long / Short aggregate (qty-weighted avg entry).</summary>
public sealed class NetSide
{
    public decimal Qty { get; init; }
    public decimal AvgEntry { get; init; }
}

public abstract record SizingResult
{
    public sealed record Accept(decimal Qty) : SizingResult;

    public sealed record Reject(string Reason, string Message) : SizingResult;
}

public abstract record OpenMarketResult
{
    public sealed record Success(IReadOnlyList<SessionLot> Lots, SessionLot Lot) : OpenMarketResult;

    public sealed record Failure(string Reason, string Message) : OpenMarketResult;
}

public abstract record CloseMarketResult
{
    public sealed record Success(
        IReadOnlyList<SessionLot> Lots,
        ClosedTradeInput ClosedTrade,
        decimal RealizedPnl) : CloseMarketResult;

    public sealed record Failure(string Reason, string Message) : CloseMarketResult;
}

public abstract record CloseQtyResult
{
    public sealed record Success(
        IReadOnlyList<SessionLot> Lots,
        IReadOnlyList<ClosedTradeInput> ClosedTrades,
        decimal RealizedPnl) : CloseQtyResult;

    public sealed record Failure(string Reason, string Message) : CloseQtyResult;
}

public sealed class CloseAllResult
{
    public required IReadOnlyList<SessionLot> Lots { get; init; }
    public required IReadOnlyList<ClosedTradeInput> ClosedTrades { get; init; }
    public decimal RealizedPnl { get; init; }
}

public sealed class CancelOrderResult
{
    public required IReadOnlyList<SessionOrder> Orders { get; init; }
    public SessionOrder? Cancelled { get; init; }
}

public sealed class CancelledOrder
{
    public required SessionOrder Order { get; init; }
    public required string Reason { get; init; }
}

public sealed class MatchLimitsResult
{
    public required IReadOnlyList<SessionOrder> Orders { get; init; }
    public required IReadOnlyList<SessionLot> Lots { get; init; }
    public required IReadOnlyList<ClosedTradeInput> ClosedTrades { get; init; }
    public decimal RealizedPnlDelta { get; init; }
    public required IReadOnlyList<CancelledOrder> Cancelled { get; init; }
    public required IReadOnlyList<SessionOrder> Filled { get; init; }
}
