using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.Trading.Services;

/// <summary>Shared session candle/tip helpers used by command services and the facade.</summary>
internal static class SessionSupport
{
    /// <summary>Matches FE <c>TIP_WINDOW_MIN_DAYS_MS</c>.</summary>
    public static readonly TimeSpan TipWindowMinDays = TimeSpan.FromDays(2);

    /// <summary>Matches FE <c>TIP_WINDOW_MIN_BARS</c>.</summary>
    public const int TipWindowMinBars = 500;

    /// <summary>Pad each side: max(2 days, 500 × bar duration). Matches FE tipWindowPadMs.</summary>
    public static TimeSpan TipWindowPadForInterval(string interval)
    {
        var barMs = IntervalParser.ToDurationMs(interval);
        var byBars = TimeSpan.FromMilliseconds(barMs * TipWindowMinBars);
        return byBars > TipWindowMinDays ? byBars : TipWindowMinDays;
    }

    /// <summary>Clamp tip±pad into the session From–To range.</summary>
    public static (DateTime Start, DateTime End) TipWindowBounds(
        DateTime watermark,
        DateTime rangeStart,
        DateTime rangeEnd,
        string interval)
    {
        var tip = DateTime.SpecifyKind(watermark, DateTimeKind.Utc);
        var pad = TipWindowPadForInterval(interval);
        var start = tip - pad;
        var end = tip + pad;
        var rs = DateTime.SpecifyKind(rangeStart, DateTimeKind.Utc);
        var re = DateTime.SpecifyKind(rangeEnd, DateTimeKind.Utc);
        if (start < rs)
        {
            start = rs;
        }

        if (end > re)
        {
            end = re;
        }

        if (start >= end)
        {
            start = rs;
            end = re;
        }

        return (start, end);
    }

    public static async Task<IReadOnlyList<MarketData>> LoadSessionCandlesAsync(
        ICandleLoadService candles,
        TradingSession session,
        CancellationToken cancellationToken)
    {
        if (session.RangeStart is null || session.RangeEnd is null)
        {
            throw new SessionCommandException("Session is missing candle range references.");
        }

        var packStart = session.ActivePackStart ?? session.RangeStart.Value;
        var packEnd = session.ActivePackEnd ?? session.RangeEnd.Value;

        var result = await candles.LoadAsync(
            session.Symbol,
            session.Interval,
            packStart,
            packEnd,
            refresh: false,
            offset: null,
            limit: null,
            cancellationToken: cancellationToken);

        if (result.Candles.Count == 0)
        {
            throw new SessionCommandException("No candles available for the session range.");
        }

        return result.Candles;
    }

    public static async Task<IReadOnlyList<MarketData>> EnsureCandlesCoverPlayheadAsync(
        ICandleLoadService candles,
        TradingSession session,
        int toPlayhead,
        CancellationToken cancellationToken)
    {
        var series = await LoadSessionCandlesAsync(candles, session, cancellationToken);
        var guard = 0;
        while (toPlayhead > series.Count && guard < 32)
        {
            guard++;
            if (session.RangeEnd is null || session.ActivePackEnd is null)
            {
                break;
            }

            var rangeEnd = DateTime.SpecifyKind(session.RangeEnd.Value, DateTimeKind.Utc);
            var packEnd = DateTime.SpecifyKind(session.ActivePackEnd.Value, DateTimeKind.Utc);
            if (packEnd >= rangeEnd)
            {
                break;
            }

            var nextEnd = packEnd + TipWindowPadForInterval(session.Interval);
            if (nextEnd > rangeEnd)
            {
                nextEnd = rangeEnd;
            }

            if (nextEnd <= packEnd)
            {
                break;
            }

            session.ActivePackEnd = nextEnd;
            series = await LoadSessionCandlesAsync(candles, session, cancellationToken);
        }

        return series;
    }

    public static bool SeriesCoversWatermark(
        IReadOnlyList<MarketData> candles,
        DateTime watermark,
        string interval)
    {
        if (candles.Count == 0)
        {
            return false;
        }

        var tip = DateTime.SpecifyKind(watermark, DateTimeKind.Utc);
        var first = DateTime.SpecifyKind(candles[0].Timestamp, DateTimeKind.Utc);
        var lastOpen = DateTime.SpecifyKind(candles[^1].Timestamp, DateTimeKind.Utc);
        var lastEnd = lastOpen.AddMilliseconds(IntervalParser.ToDurationMs(interval));
        return first <= tip && tip < lastEnd;
    }

    public static async Task<(decimal MarkPrice, DateTime MarkTime)> ResolveMarkAsync(
        ICandleLoadService candles,
        TradingSession session,
        decimal? markPrice,
        DateTime? markTime,
        CancellationToken cancellationToken)
    {
        _ = markPrice;
        _ = markTime;

        var series = await LoadSessionCandlesAsync(candles, session, cancellationToken);
        if (session.Playhead <= 0 || session.Playhead > series.Count)
        {
            throw new SessionCommandException("Cannot trade without a mark candle.");
        }

        var candle = series[session.Playhead - 1];
        var packTime = DateTime.SpecifyKind(candle.Timestamp, DateTimeKind.Utc);
        var packClose = candle.Close;

        if (session.SimMarkPrice is { } cached && cached > 0 &&
            session.SimMarkTime is { } cachedTime)
        {
            var tipTime = DateTime.SpecifyKind(cachedTime, DateTimeKind.Utc);
            var watermark = session.SimWatermark is { } w
                ? DateTime.SpecifyKind(w, DateTimeKind.Utc)
                : tipTime;
            if (watermark >= packTime)
            {
                return (cached, watermark);
            }
        }

        return (packClose, packTime);
    }

    public static async Task SeedSimClockAsync(
        ICandleLoadService candles,
        TradingSession session,
        CancellationToken cancellationToken)
    {
        if (session.Playhead <= 0)
        {
            return;
        }

        try
        {
            var series = await LoadSessionCandlesAsync(candles, session, cancellationToken);
            if (session.Playhead <= series.Count)
            {
                AdvanceSimClock(session, series[session.Playhead - 1]);
            }
        }
        catch (SessionCommandException)
        {
            // Range packs may be missing at Start in tests; clock seeds on first advance.
        }
    }

    public static void AdvanceSimClock(TradingSession session, MarketData tipCandle)
    {
        var tip = DateTime.SpecifyKind(tipCandle.Timestamp, DateTimeKind.Utc);
        if (session.SimWatermark is null || tip > session.SimWatermark)
        {
            session.SimWatermark = tip;
        }

        session.SimMarkPrice = tipCandle.Close;
        session.SimMarkTime = tip;
    }

    public static int PlayheadForWatermark(
        IReadOnlyList<MarketData> candles,
        DateTime watermark,
        string interval)
    {
        if (candles.Count == 0)
        {
            return 0;
        }

        var target = DateTime.SpecifyKind(watermark, DateTimeKind.Utc);
        var barMs = IntervalParser.ToDurationMs(interval);

        for (var i = 0; i < candles.Count; i++)
        {
            var open = DateTime.SpecifyKind(candles[i].Timestamp, DateTimeKind.Utc);
            if (open == target)
            {
                return i + 1;
            }

            var end = i + 1 < candles.Count
                ? DateTime.SpecifyKind(candles[i + 1].Timestamp, DateTimeKind.Utc)
                : open.AddMilliseconds(barMs);

            if (open < target && target < end)
            {
                return i + 1;
            }

            if (open > target)
            {
                return i;
            }
        }

        return candles.Count;
    }

    public static void EnsureLockedForTrade(TradingSession session)
    {
        if (!session.SessionLocked)
        {
            throw new SessionCommandException("Play once to lock the session before trading.");
        }
    }

    public static string RequireSide(string? side)
    {
        if (string.Equals(side, "long", StringComparison.OrdinalIgnoreCase))
        {
            return "long";
        }

        if (string.Equals(side, "short", StringComparison.OrdinalIgnoreCase))
        {
            return "short";
        }

        throw new SessionCommandException("Side must be long or short.");
    }

    public static string RequireIntent(string? intent)
    {
        if (string.Equals(intent, "open", StringComparison.OrdinalIgnoreCase))
        {
            return "open";
        }

        if (string.Equals(intent, "close", StringComparison.OrdinalIgnoreCase))
        {
            return "close";
        }

        throw new SessionCommandException("Intent must be open or close.");
    }

    public static decimal AvailableQty(IEnumerable<SessionLot> lots, string side) =>
        lots.Where(l => string.Equals(l.Side, side, StringComparison.OrdinalIgnoreCase))
            .Sum(l => l.Qty);

    public static OhlcBar ToOhlc(MarketData candle) =>
        new()
        {
            Open = candle.Open,
            High = candle.High,
            Low = candle.Low,
            Close = candle.Close,
            Timestamp = candle.Timestamp
        };
}
