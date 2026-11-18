using TradingTutor.Trading.Services;

namespace TradingTutor.Trading.Interfaces;

public interface ICandleLoadService
{
    Task<CandleLoadResult> LoadAsync(
        string symbol,
        string interval,
        DateTime start,
        DateTime end,
        bool refresh = false,
        CancellationToken cancellationToken = default);
}
