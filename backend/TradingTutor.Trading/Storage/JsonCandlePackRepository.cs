using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;

namespace TradingTutor.Trading.Storage;

public class JsonCandlePackRepository : ICandlePackRepository
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly string _rootPath;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public JsonCandlePackRepository(IOptions<CandleStorageOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var root = string.IsNullOrWhiteSpace(options.Value.RootPath)
            ? "data/candles"
            : options.Value.RootPath;
        _rootPath = Path.GetFullPath(root);
    }

    public async Task<CandlePack?> GetAsync(
        string exchange,
        string symbol,
        string interval,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(exchange);
        ArgumentException.ThrowIfNullOrWhiteSpace(symbol);
        ArgumentException.ThrowIfNullOrWhiteSpace(interval);

        var path = ResolvePath(exchange, symbol, interval);
        if (!File.Exists(path))
        {
            return null;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<CandlePack>(
                stream,
                SerializerOptions,
                cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task SaveAsync(CandlePack pack, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(pack);
        ArgumentException.ThrowIfNullOrWhiteSpace(pack.Exchange);
        ArgumentException.ThrowIfNullOrWhiteSpace(pack.Symbol);
        ArgumentException.ThrowIfNullOrWhiteSpace(pack.Interval);

        var path = ResolvePath(pack.Exchange, pack.Symbol, pack.Interval);
        var directory = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);

        var tempPath = path + ".tmp";

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using (var stream = File.Create(tempPath))
            {
                await JsonSerializer.SerializeAsync(stream, pack, SerializerOptions, cancellationToken);
            }

            File.Move(tempPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try
                {
                    File.Delete(tempPath);
                }
                catch
                {
                    // best-effort cleanup
                }
            }

            _gate.Release();
        }
    }

    internal string ResolvePath(string exchange, string symbol, string interval)
    {
        var safeExchange = SanitizePathSegment(exchange);
        var safeSymbol = SanitizePathSegment(symbol.ToUpperInvariant());
        var safeInterval = SanitizePathSegment(interval);
        return Path.Combine(_rootPath, safeExchange, $"{safeSymbol}_{safeInterval}.json");
    }

    private static string SanitizePathSegment(string value)
    {
        var trimmed = value.Trim();
        foreach (var c in Path.GetInvalidFileNameChars())
        {
            trimmed = trimmed.Replace(c, '_');
        }

        return trimmed;
    }
}
