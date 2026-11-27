namespace TradingTutor.Trading.Services;

/// <summary>
/// Shared chart/session interval aliases → duration and ByBit API token.
/// Unknown or blank intervals throw <see cref="CandleLoadValidationException"/>.
/// </summary>
public static class IntervalParser
{
    public static TimeSpan ToDuration(string interval)
    {
        var key = RequireKey(interval);
        if (key is "1M" or "M")
        {
            return TimeSpan.FromDays(30);
        }

        return key.ToLowerInvariant() switch
        {
            "1" or "1m" => TimeSpan.FromMinutes(1),
            "3" or "3m" => TimeSpan.FromMinutes(3),
            "5" or "5m" => TimeSpan.FromMinutes(5),
            "15" or "15m" => TimeSpan.FromMinutes(15),
            "30" or "30m" => TimeSpan.FromMinutes(30),
            "60" or "1h" => TimeSpan.FromHours(1),
            "120" or "2h" => TimeSpan.FromHours(2),
            "240" or "4h" => TimeSpan.FromHours(4),
            "360" or "6h" => TimeSpan.FromHours(6),
            "720" or "12h" => TimeSpan.FromHours(12),
            "d" or "1d" => TimeSpan.FromDays(1),
            "w" or "1w" => TimeSpan.FromDays(7),
            _ => throw Unsupported(interval)
        };
    }

    public static double ToDurationMs(string interval) => ToDuration(interval).TotalMilliseconds;

    public static string ToByBitInterval(string interval)
    {
        var key = RequireKey(interval);
        if (key is "1M" or "M")
        {
            return "M";
        }

        return key.ToLowerInvariant() switch
        {
            "1" or "1m" => "1",
            "3" or "3m" => "3",
            "5" or "5m" => "5",
            "15" or "15m" => "15",
            "30" or "30m" => "30",
            "60" or "1h" => "60",
            "120" or "2h" => "120",
            "240" or "4h" => "240",
            "360" or "6h" => "360",
            "720" or "12h" => "720",
            "d" or "1d" => "D",
            "w" or "1w" => "W",
            _ => throw Unsupported(interval)
        };
    }

    public static int EstimateBarCount(DateTime start, DateTime end, string interval)
    {
        var duration = ToDuration(interval);
        if (duration <= TimeSpan.Zero)
        {
            throw new CandleLoadValidationException($"Invalid interval duration for '{interval}'.");
        }

        var total = end - start;
        if (total <= TimeSpan.Zero)
        {
            return 0;
        }

        return (int)Math.Ceiling(total.TotalMilliseconds / duration.TotalMilliseconds);
    }

    private static string RequireKey(string interval)
    {
        if (string.IsNullOrWhiteSpace(interval))
        {
            throw new CandleLoadValidationException("Interval is required.");
        }

        return interval.Trim();
    }

    private static CandleLoadValidationException Unsupported(string interval) =>
        new($"Unsupported interval '{interval}'.");
}
