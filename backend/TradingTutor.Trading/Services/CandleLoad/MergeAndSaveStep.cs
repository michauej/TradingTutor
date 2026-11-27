using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Storage;

namespace TradingTutor.Trading.Services.CandleLoad;

internal sealed class MergeAndSaveStep
{
    private readonly ICandlePackRepository _repository;

    public MergeAndSaveStep(ICandlePackRepository repository)
    {
        _repository = repository;
    }

    public async Task ExecuteAsync(CandleLoadContext ctx, CancellationToken cancellationToken)
    {
        if (ctx.Downloaded is null)
        {
            throw new InvalidOperationException("FetchIfNeeded must run before MergeAndSave.");
        }

        var updatedAt = DateTime.UtcNow;
        ctx.MergedPack = CandlePackMerger.MergePack(
            ctx.Existing,
            ctx.Downloaded,
            ctx.ExchangeName,
            ctx.Symbol,
            ctx.Interval,
            ctx.RangeStart,
            ctx.RangeEnd,
            ctx.Incomplete,
            updatedAt);

        await _repository.SaveAsync(ctx.MergedPack, cancellationToken);
    }
}
