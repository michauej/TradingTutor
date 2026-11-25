using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;
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

        var exchangeName = _exchange.ExchangeName;
        var existing = await _repository.GetAsync(
            exchangeName,
            normalizedSymbol,
            normalizedInterval,
            cancellationToken);

        if (!refresh && existing is not null && CoversRange(existing, rangeStart, rangeEnd))
        {
            var localCandles = FilterRange(existing.Candles, rangeStart, rangeEnd);
            return PageResult(
                localCandles,
                source: "local",
                incomplete: existing.Incomplete,
                message: existing.Incomplete
                    ? "Loaded from local pack marked incomplete."
                    : null,
                offset,
                limit);
        }

        var fetchStart = rangeStart;
        var fetchEnd = rangeEnd;
        if (!refresh && existing is not null && existing.Candles.Count > 0)
        {
            // Prefer downloading only the missing span when pack partially overlaps.
            var packMin = existing.Candles[0].Timestamp;
            var packMax = existing.Candles[^1].Timestamp;
            if (packMin <= rangeStart && packMax < rangeEnd)
            {
                fetchStart = packMax;
            }
            else if (packMax >= rangeEnd && packMin > rangeStart)
            {
                fetchEnd = packMin;
            }
        }

        List<MarketData> downloaded;
        var incomplete = false;
        string? partialMessage = null;

        try
        {
            var pageResult = await PageExchangeAsync(
                normalizedSymbol,
                normalizedInterval,
                fetchStart,
                fetchEnd,
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
            if (existing is not null && CoversRange(existing, rangeStart, rangeEnd))
            {
                _logger.LogWarning(ex, "Exchange fetch failed; falling back to covering local pack");
                return PageResult(
                    FilterRange(existing.Candles, rangeStart, rangeEnd),
                    source: "local",
                    incomplete: true,
                    message: "Exchange fetch failed; returned covering local pack.",
                    offset,
                    limit);
            }

            throw new CandleLoadExchangeException(
                "Failed to fetch market data from the exchange.",
                ex);
        }

        if (downloaded.Count == 0)
        {
            if (existing is not null && FilterRange(existing.Candles, rangeStart, rangeEnd).Count > 0)
            {
                return PageResult(
                    FilterRange(existing.Candles, rangeStart, rangeEnd),
                    source: "local",
                    incomplete: existing.Incomplete || incomplete,
                    message: "Exchange returned no new candles; using local pack.",
                    offset,
                    limit);
            }

            throw new CandleLoadExchangeException("Exchange returned no candles for the requested range.");
        }

        var updatedAt = DateTime.UtcNow;
        var mergedPack = CandlePackMerger.MergePack(
            existing,
            downloaded,
            exchangeName,
            normalizedSymbol,
            normalizedInterval,
            rangeStart,
            rangeEnd,
            incomplete,
            updatedAt);

        await _repository.SaveAsync(mergedPack, cancellationToken);

        var resultCandles = FilterRange(mergedPack.Candles, rangeStart, rangeEnd);
        var source = incomplete ? "partial" : "exchange";

        return PageResult(
            resultCandles,
            source,
            incomplete,
            partialMessage,
            offset,
            limit);
    }

    private CandleLoadResult PageResult(
        IReadOnlyList<MarketData> all,
        string source,
        bool incomplete,
        string? message,
        int? offset,
        int? limit)
    {
        var total = all.Count;
        if (offset is null && limit is null)
        {
            return new CandleLoadResult
            {
                Candles = all,
                Source = source,
                Incomplete = incomplete,
                Message = message,
                Offset = 0,
                TotalCount = total,
                HasMore = false
            };
        }

        var start = Math.Clamp(offset ?? 0, 0, total);
        var defaultPage = Math.Max(1, _options.PackPageSize);
        var take = Math.Max(1, limit ?? defaultPage);
        var slice = all.Skip(start).Take(take).ToList();

        return new CandleLoadResult
        {
            Candles = slice,
            Source = source,
            Incomplete = incomplete,
            Message = message,
            Offset = start,
            TotalCount = total,
            HasMore = start + slice.Count < total
        };
    }

    private async Task<(List<MarketData> Candles, bool Incomplete, string? Message)> PageExchangeAsync(
        string symbol,
        string interval,
        DateTime start,
        DateTime end,
        CancellationToken cancellationToken)
    {
        var collected = new List<MarketData>();
        var pageEnd = end;
        var incomplete = false;
        string? message = null;

        // No app-level bar cap — page until the requested start is reached (ByBit page = 1000).
        while (pageEnd > start)
        {
            cancellationToken.ThrowIfCancellationRequested();

            IReadOnlyList<MarketData> page;
            try
            {
                page = await _exchange.GetMarketDataAsync(
                    symbol,
                    interval,
                    startTime: start,
                    endTime: pageEnd,
                    limit: PageSize,
                    cancellationToken: cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                if (collected.Count == 0)
                {
                    throw;
                }

                incomplete = true;
                message = $"Download interrupted after {collected.Count} bars: {ex.Message}";
                _logger.LogWarning(ex, "Partial candle download for {Symbol} {Interval}", symbol, interval);
                break;
            }

            if (page.Count == 0)
            {
                break;
            }

            // Pages arrive oldest-first from ByBitService; paginate backward via oldest timestamp.
            collected.AddRange(page);

            if (page.Count < PageSize)
            {
                break;
            }

            var oldest = page[0].Timestamp;
            if (oldest <= start)
            {
                break;
            }

            // Step just before oldest to avoid re-fetching the same bar.
            var nextEnd = oldest.AddMilliseconds(-1);
            if (nextEnd >= pageEnd)
            {
                incomplete = true;
                message = "Pagination failed to advance; stopping early.";
                break;
            }

            pageEnd = nextEnd;
        }

        var mergedPage = CandlePackMerger.MergeCandles(null, collected);
        return (mergedPage, incomplete, message);
    }

    internal static bool CoversRange(CandlePack pack, DateTime start, DateTime end)
    {
        if (pack.Candles.Count == 0)
        {
            return false;
        }

        var min = pack.Candles[0].Timestamp;
        var max = pack.Candles[^1].Timestamp;
        return min <= start && max >= end;
    }

    internal static List<MarketData> FilterRange(
        IReadOnlyList<MarketData> candles,
        DateTime start,
        DateTime end)
    {
        return candles
            .Where(c => c.Timestamp >= start && c.Timestamp <= end)
            .ToList();
    }
}
