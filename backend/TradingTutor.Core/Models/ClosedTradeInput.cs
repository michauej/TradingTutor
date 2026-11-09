namespace TradingTutor.Core.Models;

/// <summary>
/// Closed-trade journal row posted from the diary (mirrors frontend ClosedTrade).
/// Side must be <c>long</c> or <c>short</c>.
/// </summary>
public class ClosedTradeInput
{
    public string Id { get; set; } = string.Empty;
    public string Side { get; set; } = string.Empty;
    public decimal Qty { get; set; }
    public decimal EntryPrice { get; set; }
    public DateTime EntryTime { get; set; }
    public decimal ExitPrice { get; set; }
    public DateTime ExitTime { get; set; }
    public decimal RealizedPnl { get; set; }
}
