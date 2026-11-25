using TradingTutor.Core.Models;

namespace TradingTutor.Trading.Services;

public sealed class CandleLoadResult
{
    public required IReadOnlyList<MarketData> Candles { get; init; }
    public required string Source { get; init; }
    public required bool Incomplete { get; init; }
    public string? Message { get; init; }

    /// <summary>0-based index of the first returned bar in the full filtered series.</summary>
    public int Offset { get; init; }

    /// <summary>Total bars available for the requested range (after ensure/download).</summary>
    public int TotalCount { get; init; }

    /// <summary>True when more bars exist after <see cref="Offset"/> + returned count.</summary>
    public bool HasMore { get; init; }
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
