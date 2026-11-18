using TradingTutor.Core.Models;

namespace TradingTutor.Trading.Interfaces;

public interface ICandlePackRepository
{
    Task<CandlePack?> GetAsync(
        string exchange,
        string symbol,
        string interval,
        CancellationToken cancellationToken = default);

    Task SaveAsync(CandlePack pack, CancellationToken cancellationToken = default);
}
