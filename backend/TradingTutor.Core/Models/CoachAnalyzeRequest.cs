namespace TradingTutor.Core.Models;

public class CoachAnalyzeRequest
{
    public List<ClosedTradeInput> ClosedTrades { get; set; } = [];

    /// <summary>Rule pack id: <c>hygiene</c> (default) or <c>ict</c>.</summary>
    public string RulePackId { get; set; } = "hygiene";

    /// <summary>Optional session candle prefix (required for ICT pack).</summary>
    public List<CandleInput>? Candles { get; set; }
}
