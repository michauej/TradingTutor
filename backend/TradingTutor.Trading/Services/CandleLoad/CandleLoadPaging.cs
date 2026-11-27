using Microsoft.Extensions.Logging;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Storage;

namespace TradingTutor.Trading.Services.CandleLoad;

internal static class CandleLoadPaging
{
    public static CandleLoadResult PageResult(
        IReadOnlyList<MarketData> all,
        string source,
        bool incomplete,
        string? message,
        int? offset,
        int? limit,
        int packPageSize)
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
        var defaultPage = Math.Max(1, packPageSize);
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

    public static async Task<(List<MarketData> Candles, bool Incomplete, string? Message)> PageExchangeAsync(
        IExchangeService exchange,
        ILogger logger,
        string symbol,
        string interval,
        DateTime start,
        DateTime end,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var collected = new List<MarketData>();
        var pageEnd = end;
        var incomplete = false;
        string? message = null;

        while (pageEnd > start)
        {
            cancellationToken.ThrowIfCancellationRequested();

            IReadOnlyList<MarketData> page;
            try
            {
                page = await exchange.GetMarketDataAsync(
                    symbol,
                    interval,
                    startTime: start,
                    endTime: pageEnd,
                    limit: pageSize,
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
                logger.LogWarning(ex, "Partial candle download for {Symbol} {Interval}", symbol, interval);
                break;
            }

            if (page.Count == 0)
            {
                break;
            }

            collected.AddRange(page);

            if (page.Count < pageSize)
            {
                break;
            }

            var oldest = page[0].Timestamp;
            if (oldest <= start)
            {
                break;
            }

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

    public static bool CoversRange(CandlePack pack, DateTime start, DateTime end)
    {
        if (pack.Candles.Count == 0)
        {
            return false;
        }

        var min = pack.Candles[0].Timestamp;
        var max = pack.Candles[^1].Timestamp;
        return min <= start && max >= end;
    }

    public static List<MarketData> FilterRange(
        IReadOnlyList<MarketData> candles,
        DateTime start,
        DateTime end) =>
        candles
            .Where(c => c.Timestamp >= start && c.Timestamp <= end)
            .ToList();
}
