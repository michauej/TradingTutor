using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;
using TradingTutor.Trading.Services.CandleLoad;
using TradingTutor.Trading.Storage;

namespace TradingTutor.Trading.Services;

public class CandleLoadService : ICandleLoadService
{
    /// <summary>ByBit single-page max — not an app range clamp.</summary>
    public const int PageSize = 1000;

    private readonly IExchangeService _exchange;
    private readonly ICandlePackRepository _repository;
    private readonly CandleStorageOptions _options;
    private readonly ILogger<CandleLoadService> _logger;

    public CandleLoadService(
        IExchangeService exchange,
        ICandlePackRepository repository,
        IOptions<CandleStorageOptions> options,
        ILogger<CandleLoadService> logger)
    {
        _exchange = exchange;
        _repository = repository;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<CandleLoadResult> LoadAsync(
        string symbol,
        string interval,
        DateTime start,
        DateTime end,
        bool refresh = false,
        int? offset = null,
        int? limit = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(symbol);
        ArgumentException.ThrowIfNullOrWhiteSpace(interval);

        var normalizedSymbol = symbol.Trim().ToUpperInvariant();
        var normalizedInterval = interval.Trim();
        var rangeStart = DateTime.SpecifyKind(start, DateTimeKind.Utc);
        var rangeEnd = DateTime.SpecifyKind(end, DateTimeKind.Utc);

        if (rangeStart >= rangeEnd)
        {
            throw new CandleLoadValidationException("startTime must be earlier than endTime.");
        }

        if (offset is < 0)
        {
            throw new CandleLoadValidationException("offset must be >= 0.");
        }

        if (limit is <= 0)
        {
            throw new CandleLoadValidationException("limit must be > 0 when provided.");
        }

        var ctx = new CandleLoadContext
        {
            Symbol = normalizedSymbol,
            Interval = normalizedInterval,
            RangeStart = rangeStart,
            RangeEnd = rangeEnd,
            Refresh = refresh,
            Offset = offset,
            Limit = limit,
            ExchangeName = _exchange.ExchangeName
        };

        var cacheCheck = new CacheCheckStep(_repository, _options, _logger);
        await cacheCheck.ExecuteAsync(ctx, cancellationToken);
        if (ctx.EarlyResult is not null)
        {
            return ctx.EarlyResult;
        }

        var fetch = new FetchIfNeededStep(_exchange, _options, _logger);
        await fetch.ExecuteAsync(ctx, cancellationToken);
        if (ctx.EarlyResult is not null)
        {
            return ctx.EarlyResult;
        }

        var merge = new MergeAndSaveStep(_repository);
        await merge.ExecuteAsync(ctx, cancellationToken);

        var page = new PageResultStep(_options);
        page.Execute(ctx);

        return ctx.Result!;
    }

    // Kept for existing tests that call these helpers directly.
    internal static bool CoversRange(CandlePack pack, DateTime start, DateTime end) =>
        CandleLoadPaging.CoversRange(pack, start, end);

    internal static List<MarketData> FilterRange(
        IReadOnlyList<MarketData> candles,
        DateTime start,
        DateTime end) =>
        CandleLoadPaging.FilterRange(candles, start, end);
}
