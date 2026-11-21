namespace TradingTutor.Core.Models;

/// <summary>
/// Compact OHLC bar for coach analyze (session candle prefix).
/// </summary>
public class CandleInput
{
    public DateTime Timestamp { get; set; }
    public decimal Open { get; set; }
    public decimal High { get; set; }
    public decimal Low { get; set; }
    public decimal Close { get; set; }
}
