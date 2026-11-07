using TradingTutor.Models;

namespace TradingTutor.Services;

public interface IExchangeService
{
    string ExchangeName { get; }

    Task<IReadOnlyList<MarketData>> GetMarketDataAsync(
        string symbol,
        string interval,
        DateTime? startTime = null,
        DateTime? endTime = null,
        int limit = 200,
        CancellationToken cancellationToken = default);
}
