using TradingTutor.Core.Models;

namespace TradingTutor.Trading.Services;

public sealed class CandleLoadResult
{
    public required IReadOnlyList<MarketData> Candles { get; init; }
    public required string Source { get; init; }
    public required bool Incomplete { get; init; }
    public string? Message { get; init; }
}

public sealed class CandleLoadValidationException : Exception
{
    public CandleLoadValidationException(string message) : base(message)
    {
    }
}

public sealed class CandleLoadExchangeException : Exception
{
    public CandleLoadExchangeException(string message, Exception? inner = null)
        : base(message, inner)
    {
    }
}
