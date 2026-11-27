using Microsoft.Extensions.Logging;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;

namespace TradingTutor.Trading.Services.CandleLoad;

internal sealed class FetchIfNeededStep
{
    private readonly IExchangeService _exchange;
    private readonly CandleStorageOptions _options;
    private readonly ILogger _logger;

    public FetchIfNeededStep(
        IExchangeService exchange,
        CandleStorageOptions options,
        ILogger logger)
    {
        _exchange = exchange;
        _options = options;
        _logger = logger;
    }

    public async Task ExecuteAsync(CandleLoadContext ctx, CancellationToken cancellationToken)
    {
        var fetchStart = ctx.RangeStart;
        var fetchEnd = ctx.RangeEnd;
        var existing = ctx.Existing;

        if (!ctx.Refresh && existing is not null && existing.Candles.Count > 0)
        {
            var packMin = existing.Candles[0].Timestamp;
            var packMax = existing.Candles[^1].Timestamp;
            if (packMin <= ctx.RangeStart && packMax < ctx.RangeEnd)
            {
                fetchStart = packMax;
            }
            else if (packMax >= ctx.RangeEnd && packMin > ctx.RangeStart)
            {
                fetchEnd = packMin;
            }
        }

        List<MarketData> downloaded;
        var incomplete = false;
        string? partialMessage = null;

        try
        {
            var pageResult = await CandleLoadPaging.PageExchangeAsync(
                _exchange,
                _logger,
                ctx.Symbol,
                ctx.Interval,
                fetchStart,
                fetchEnd,
                CandleLoadService.PageSize,
                cancellationToken);
            downloaded = pageResult.Candles;
            incomplete = pageResult.Incomplete;
            if (incomplete)
            {
                partialMessage = pageResult.Message ??
                    "Download stopped early (exchange returned a short page or error). Pack saved as incomplete.";
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            if (existing is not null &&
                CandleLoadPaging.CoversRange(existing, ctx.RangeStart, ctx.RangeEnd))
            {
                _logger.LogWarning(ex, "Exchange fetch failed; falling back to covering local pack");
                ctx.EarlyResult = CandleLoadPaging.PageResult(
                    CandleLoadPaging.FilterRange(existing.Candles, ctx.RangeStart, ctx.RangeEnd),
                    source: "local",
                    incomplete: true,
                    message: "Exchange fetch failed; returned covering local pack.",
                    ctx.Offset,
                    ctx.Limit,
                    _options.PackPageSize);
                return;
            }

            throw new CandleLoadExchangeException(
                "Failed to fetch market data from the exchange.",
                ex);
        }

        if (downloaded.Count == 0)
        {
            if (existing is not null &&
                CandleLoadPaging.FilterRange(existing.Candles, ctx.RangeStart, ctx.RangeEnd).Count > 0)
            {
                ctx.EarlyResult = CandleLoadPaging.PageResult(
                    CandleLoadPaging.FilterRange(existing.Candles, ctx.RangeStart, ctx.RangeEnd),
                    source: "local",
                    incomplete: existing.Incomplete || incomplete,
                    message: "Exchange returned no new candles; using local pack.",
                    ctx.Offset,
                    ctx.Limit,
                    _options.PackPageSize);
                return;
            }

            throw new CandleLoadExchangeException("Exchange returned no candles for the requested range.");
        }

        ctx.Downloaded = downloaded;
        ctx.Incomplete = incomplete;
        ctx.PartialMessage = partialMessage;
    }
}
