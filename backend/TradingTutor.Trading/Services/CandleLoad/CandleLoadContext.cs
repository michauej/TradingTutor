using TradingTutor.Core.Models;
using TradingTutor.Trading.Storage;

namespace TradingTutor.Trading.Services.CandleLoad;

internal sealed class CandleLoadContext
{
    public required string Symbol { get; init; }
    public required string Interval { get; init; }
    public required DateTime RangeStart { get; init; }
    public required DateTime RangeEnd { get; init; }
    public required bool Refresh { get; init; }
    public required int? Offset { get; init; }
    public required int? Limit { get; init; }
    public required string ExchangeName { get; init; }

    public CandlePack? Existing { get; set; }
    public CandleLoadResult? EarlyResult { get; set; }

    public List<MarketData>? Downloaded { get; set; }
    public bool Incomplete { get; set; }
    public string? PartialMessage { get; set; }

    public CandlePack? MergedPack { get; set; }
    public CandleLoadResult? Result { get; set; }
}
