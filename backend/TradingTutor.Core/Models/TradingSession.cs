namespace TradingTutor.Core.Models;

/// <summary>
/// Full paper-trading session snapshot for durable Save/Load.
/// Candle OHLC is referenced (exchange/symbol/interval/range), not embedded.
/// </summary>
public class TradingSession
{
    public string Id { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public string Symbol { get; set; } = string.Empty;
    public string Exchange { get; set; } = "ByBit";
    public string Interval { get; set; } = string.Empty;

    /// <summary>ISO / DateTime bounds used to reload candle packs on review.</summary>
    public DateTime? RangeStart { get; set; }
    public DateTime? RangeEnd { get; set; }

    /// <summary>
    /// Active pack window for the current interval (tip-centered on LTF re-anchor).
    /// When null, <see cref="RangeStart"/>/<see cref="RangeEnd"/> are used.
    /// </summary>
    public DateTime? ActivePackStart { get; set; }

    /// <summary>See <see cref="ActivePackStart"/>.</summary>
    public DateTime? ActivePackEnd { get; set; }

    /// <summary>Session start as <c>YYYY-MM-DD</c> (date input value).</summary>
    public string SessionStartDate { get; set; } = string.Empty;

    public int Playhead { get; set; }
    public bool SessionLocked { get; set; }

    /// <summary>
    /// Latest sim wall-clock time the learner has reached. Never moves backward on TF switch.
    /// </summary>
    public DateTime? SimWatermark { get; set; }

    /// <summary>
    /// Server mark at <see cref="SimWatermark"/> (pack close). Survives HTF re-anchor so
    /// the forming HTF bar is not used as price authority while paused.
    /// </summary>
    public decimal? SimMarkPrice { get; set; }

    /// <summary>Timestamp paired with <see cref="SimMarkPrice"/>.</summary>
    public DateTime? SimMarkTime { get; set; }

    public decimal StartingBalance { get; set; }
    public decimal RealizedPnl { get; set; }

    public List<SessionLot> Lots { get; set; } = [];
    public List<SessionOrder> PendingOrders { get; set; } = [];
    public List<ClosedTradeInput> ClosedTrades { get; set; } = [];

    /// <summary>Last coach verdict (null/empty until analyzed).</summary>
    public string? CoachVerdict { get; set; }

    /// <summary>Last coach analysis text.</summary>
    public string? CoachAnalysis { get; set; }

    public List<RuleFinding> CoachFindings { get; set; } = [];

    public DateTime? CoachAnalyzedAt { get; set; }
}

/// <summary>List/summary row — enough for Load picker without full snapshot.</summary>
public class TradingSessionSummary
{
    public string Id { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string Symbol { get; set; } = string.Empty;
    public int ClosedTradeCount { get; set; }
    public decimal StartingBalance { get; set; }
}

/// <summary>Hidden lot under a net-per-side aggregate (mirrors frontend Lot).</summary>
public class SessionLot
{
    public string Id { get; set; } = string.Empty;
    public string Side { get; set; } = string.Empty;
    public decimal Qty { get; set; }
    public decimal EntryPrice { get; set; }
    public DateTime EntryTime { get; set; }
}

/// <summary>Resting or market order ticket (mirrors frontend Order).</summary>
public class SessionOrder
{
    public string Id { get; set; } = string.Empty;
    public string Side { get; set; } = string.Empty;
    public string Intent { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public decimal Qty { get; set; }
    public decimal? LimitPrice { get; set; }
    public DateTime CreatedAt { get; set; }
}
