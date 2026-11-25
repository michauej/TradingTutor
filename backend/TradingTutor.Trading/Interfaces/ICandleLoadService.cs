using TradingTutor.Trading.Services;

namespace TradingTutor.Trading.Interfaces;

public interface ICandleLoadService
{
    /// <summary>
    /// Ensure the durable pack covers <paramref name="start"/>–<paramref name="end"/>,
    /// then return either the full filtered series or a progressive page.
    /// </summary>
    /// <param name="offset">Optional 0-based page start. Null = return all bars.</param>
    /// <param name="limit">Optional page size. Null with offset null = all bars.</param>
    Task<CandleLoadResult> LoadAsync(
        string symbol,
        string interval,
        DateTime start,
        DateTime end,
        bool refresh = false,
        int? offset = null,
        int? limit = null,
        CancellationToken cancellationToken = default);
}
