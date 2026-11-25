namespace TradingTutor.Core.Models;

/// <summary>Start a server-owned paper session (metadata only — no client lots/PnL).</summary>
public class StartSessionRequest
{
    public string Symbol { get; set; } = string.Empty;
    public string Exchange { get; set; } = "ByBit";
    public string Interval { get; set; } = string.Empty;
    public DateTime? RangeStart { get; set; }
    public DateTime? RangeEnd { get; set; }
    public string SessionStartDate { get; set; } = string.Empty;
    public decimal StartingBalance { get; set; } = 10_000m;
    public int Playhead { get; set; }
}

/// <summary>
/// Absolute playhead advance. Server loads OHLC from candle packs for the jump
/// <c>[currentPlayhead, toPlayhead)</c>. Client-supplied bars are not used for fills.
/// </summary>
public class AdvanceSessionRequest
{
    public int ToPlayhead { get; set; }

    /// <summary>
    /// Deprecated / ignored. Kept for JSON compat only — fills always use server packs.
    /// </summary>
    public List<AdvanceBarDto>? Bars { get; set; }
}

/// <summary>Legacy advance bar DTO — ignored by the server (compat only).</summary>
public class AdvanceBarDto
{
    public decimal Open { get; set; }
    public decimal High { get; set; }
    public decimal Low { get; set; }
    public decimal Close { get; set; }
    public DateTime Timestamp { get; set; }
}

public class OpenSessionRequest
{
    public string Side { get; set; } = string.Empty;
    public decimal? Qty { get; set; }
    public decimal? Percent { get; set; }

    /// <summary>Ignored — mark comes from the pack candle at playhead.</summary>
    public decimal? MarkPrice { get; set; }
    public DateTime? MarkTime { get; set; }
}

/// <summary>
/// Close modes: <c>fifo</c> (full oldest lot on side), <c>lotId</c>, <c>qty</c> (FIFO partial), <c>all</c>.
/// </summary>
public class CloseSessionRequest
{
    public string Mode { get; set; } = string.Empty;
    public string? Side { get; set; }
    public string? LotId { get; set; }
    public decimal? Qty { get; set; }

    /// <summary>Ignored — mark comes from the pack candle at playhead.</summary>
    public decimal? MarkPrice { get; set; }
    public DateTime? MarkTime { get; set; }
}

public class PlaceOrderRequest
{
    public string Side { get; set; } = string.Empty;
    public string Intent { get; set; } = string.Empty;
    public string Type { get; set; } = "limit";
    public decimal Qty { get; set; }
    public decimal LimitPrice { get; set; }

    /// <summary>Ignored — mark comes from the pack candle at playhead.</summary>
    public decimal? MarkPrice { get; set; }
    public DateTime? MarkTime { get; set; }
}

/// <summary>
/// Switch the session execution interval. Remaps playhead by <c>SimWatermark</c>,
/// keeps lots/orders/closed trades, does not run fills.
/// </summary>
public class ReanchorIntervalRequest
{
    public string Interval { get; set; } = string.Empty;
}
