namespace TradingTutor.Models;

public class MarketData
{
    public string Symbol { get; set; } = string.Empty;
    public string Exchange { get; set; } = string.Empty;
    public decimal Open { get; set; }
    public decimal High { get; set; }
    public decimal Low { get; set; }
    public decimal Close { get; set; }
    public decimal Volume { get; set; }
    public DateTime Timestamp { get; set; }
    public string Interval { get; set; } = string.Empty;
}
