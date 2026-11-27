using TradingTutor.Trading.Options;

namespace TradingTutor.Trading.Services.CandleLoad;

internal sealed class PageResultStep
{
    private readonly CandleStorageOptions _options;

    public PageResultStep(CandleStorageOptions options)
    {
        _options = options;
    }

    public void Execute(CandleLoadContext ctx)
    {
        if (ctx.MergedPack is null)
        {
            throw new InvalidOperationException("MergeAndSave must run before PageResult.");
        }

        var resultCandles = CandleLoadPaging.FilterRange(
            ctx.MergedPack.Candles,
            ctx.RangeStart,
            ctx.RangeEnd);
        var source = ctx.Incomplete ? "partial" : "exchange";

        ctx.Result = CandleLoadPaging.PageResult(
            resultCandles,
            source,
            ctx.Incomplete,
            ctx.PartialMessage,
            ctx.Offset,
            ctx.Limit,
            _options.PackPageSize);
    }
}
