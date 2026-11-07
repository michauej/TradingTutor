using System.Globalization;
using System.Text.Json;
using TradingTutor.Models;

namespace TradingTutor.Services;

public class ByBitService : IExchangeService
{
    private static readonly Uri BaseAddress = new("https://api.bybit.com");
    private readonly HttpClient _httpClient;
    private readonly ILogger<ByBitService> _logger;

    public ByBitService(HttpClient httpClient, ILogger<ByBitService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        if (_httpClient.BaseAddress is null)
        {
            _httpClient.BaseAddress = BaseAddress;
        }
    }

    public string ExchangeName => "ByBit";

    public async Task<IReadOnlyList<MarketData>> GetMarketDataAsync(
        string symbol,
        string interval,
        DateTime? startTime = null,
        DateTime? endTime = null,
        int limit = 200,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(symbol);
        ArgumentException.ThrowIfNullOrWhiteSpace(interval);

        var bybitInterval = ConvertInterval(interval);
        var query = new List<string>
        {
            "category=spot",
            $"symbol={Uri.EscapeDataString(symbol.ToUpperInvariant())}",
            $"interval={Uri.EscapeDataString(bybitInterval)}",
            $"limit={Math.Clamp(limit, 1, 1000)}"
        };

        if (startTime is not null)
        {
            query.Add($"start={new DateTimeOffset(DateTime.SpecifyKind(startTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds()}");
        }

        if (endTime is not null)
        {
            query.Add($"end={new DateTimeOffset(DateTime.SpecifyKind(endTime.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds()}");
        }

        var path = $"/v5/market/kline?{string.Join('&', query)}";
        using var response = await _httpClient.GetAsync(path, cancellationToken);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

        var root = document.RootElement;
        var retCode = root.TryGetProperty("retCode", out var retCodeElement) ? retCodeElement.GetInt32() : -1;
        if (retCode != 0)
        {
            var retMsg = root.TryGetProperty("retMsg", out var retMsgElement)
                ? retMsgElement.GetString()
                : "Unknown ByBit error";
            throw new InvalidOperationException($"ByBit kline request failed ({retCode}): {retMsg}");
        }

        if (!root.TryGetProperty("result", out var result) ||
            !result.TryGetProperty("list", out var list) ||
            list.ValueKind != JsonValueKind.Array)
        {
            _logger.LogWarning("ByBit kline response for {Symbol} {Interval} had no list", symbol, interval);
            return Array.Empty<MarketData>();
        }

        var candles = new List<MarketData>(list.GetArrayLength());
        foreach (var row in list.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Array || row.GetArrayLength() < 6)
            {
                continue;
            }

            candles.Add(new MarketData
            {
                Symbol = symbol.ToUpperInvariant(),
                Exchange = ExchangeName,
                Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(ParseInt64(row[0])).UtcDateTime,
                Open = ParseDecimal(row[1]),
                High = ParseDecimal(row[2]),
                Low = ParseDecimal(row[3]),
                Close = ParseDecimal(row[4]),
                Volume = ParseDecimal(row[5]),
                Interval = interval
            });
        }

        // ByBit returns newest-first; chart consumers expect oldest-first.
        candles.Reverse();
        return candles;
    }

    internal static string ConvertInterval(string interval)
    {
        var key = interval.Trim();
        // Month must be checked before lowercasing — "1M" would otherwise collide with "1m".
        if (key is "1M" or "M")
        {
            return "M";
        }

        return key.ToLowerInvariant() switch
        {
            "1m" => "1",
            "3m" => "3",
            "5m" => "5",
            "15m" => "15",
            "30m" => "30",
            "1h" => "60",
            "2h" => "120",
            "4h" => "240",
            "6h" => "360",
            "12h" => "720",
            "1d" or "d" => "D",
            "1w" or "w" => "W",
            _ => key
        };
    }

    private static long ParseInt64(JsonElement element) =>
        element.ValueKind switch
        {
            JsonValueKind.String => long.Parse(element.GetString()!, CultureInfo.InvariantCulture),
            JsonValueKind.Number => element.GetInt64(),
            _ => throw new FormatException($"Unexpected JSON kind for timestamp: {element.ValueKind}")
        };

    private static decimal ParseDecimal(JsonElement element) =>
        element.ValueKind switch
        {
            JsonValueKind.String => decimal.Parse(element.GetString()!, CultureInfo.InvariantCulture),
            JsonValueKind.Number => element.GetDecimal(),
            _ => throw new FormatException($"Unexpected JSON kind for decimal: {element.ValueKind}")
        };
}
