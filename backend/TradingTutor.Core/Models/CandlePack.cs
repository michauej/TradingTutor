namespace TradingTutor.Core.Models;

public class CandlePack
{
    public string Symbol { get; set; } = string.Empty;
    public string Exchange { get; set; } = string.Empty;
    public string Interval { get; set; } = string.Empty;
    public bool Incomplete { get; set; }
    public DateTime? RequestedStart { get; set; }
    public DateTime? RequestedEnd { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<MarketData> Candles { get; set; } = [];
}
