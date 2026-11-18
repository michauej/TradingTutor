namespace TradingTutor.Trading.Services;

internal static class CandleInterval
{
    public static TimeSpan ToDuration(string interval)
    {
        var key = interval.Trim();
        if (key is "1M" or "M")
        {
            return TimeSpan.FromDays(30);
        }

        return key.ToLowerInvariant() switch
        {
            "1m" => TimeSpan.FromMinutes(1),
            "3m" => TimeSpan.FromMinutes(3),
            "5m" => TimeSpan.FromMinutes(5),
            "15m" => TimeSpan.FromMinutes(15),
            "30m" => TimeSpan.FromMinutes(30),
            "1h" => TimeSpan.FromHours(1),
            "2h" => TimeSpan.FromHours(2),
            "4h" => TimeSpan.FromHours(4),
            "6h" => TimeSpan.FromHours(6),
            "12h" => TimeSpan.FromHours(12),
            "1d" or "d" => TimeSpan.FromDays(1),
            "1w" or "w" => TimeSpan.FromDays(7),
            _ => throw new CandleLoadValidationException($"Unsupported interval '{interval}'.")
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
}
