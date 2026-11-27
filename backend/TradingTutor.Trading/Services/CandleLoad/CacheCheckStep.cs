using Microsoft.Extensions.Logging;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;

namespace TradingTutor.Trading.Services.CandleLoad;

internal sealed class CacheCheckStep
{
    private readonly ICandlePackRepository _repository;
    private readonly CandleStorageOptions _options;
    private readonly ILogger _logger;

    public CacheCheckStep(
        ICandlePackRepository repository,
        CandleStorageOptions options,
        ILogger logger)
    {
        _repository = repository;
        _options = options;
        _logger = logger;
    }

    public async Task ExecuteAsync(CandleLoadContext ctx, CancellationToken cancellationToken)
    {
        ctx.Existing = await _repository.GetAsync(
            ctx.ExchangeName,
            ctx.Symbol,
            ctx.Interval,
            cancellationToken);

        if (!ctx.Refresh &&
            ctx.Existing is not null &&
            CandleLoadPaging.CoversRange(ctx.Existing, ctx.RangeStart, ctx.RangeEnd))
        {
            _logger.LogInformation(
                "Candle cache hit for {Symbol} {Interval}",
                ctx.Symbol,
                ctx.Interval);
            var localCandles = CandleLoadPaging.FilterRange(
                ctx.Existing.Candles,
                ctx.RangeStart,
                ctx.RangeEnd);
            ctx.EarlyResult = CandleLoadPaging.PageResult(
                localCandles,
                source: "local",
                incomplete: ctx.Existing.Incomplete,
                message: ctx.Existing.Incomplete
                    ? "Loaded from local pack marked incomplete."
                    : null,
                ctx.Offset,
                ctx.Limit,
                _options.PackPageSize);
        }
    }
}
