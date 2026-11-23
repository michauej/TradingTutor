using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;

namespace TradingTutor.Trading.Storage;

public class JsonSessionRepository : ISessionRepository
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
    private readonly ILogger<JsonSessionRepository>? _logger;

    public JsonSessionRepository(
        IOptions<SessionStorageOptions> options,
        ILogger<JsonSessionRepository>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        var root = string.IsNullOrWhiteSpace(options.Value.RootPath)
            ? "data/sessions"
            : options.Value.RootPath;
        _rootPath = Path.GetFullPath(root);
        _logger = logger;
    }

    public async Task CreateSessionAsync(
        TradingSession session,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentException.ThrowIfNullOrWhiteSpace(session.Id);

        Directory.CreateDirectory(_rootPath);
        var path = ResolvePath(session.Id);
        var tempPath = path + ".tmp";

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using (var stream = File.Create(tempPath))
            {
                await JsonSerializer.SerializeAsync(
                    stream,
                    session,
                    SerializerOptions,
                    cancellationToken);
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

    public async Task<TradingSession?> GetSessionAsync(
        string id,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);

        var path = ResolvePath(id);
        if (!File.Exists(path))
        {
            return null;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<TradingSession>(
                stream,
                SerializerOptions,
                cancellationToken);
        }
        catch (JsonException ex)
        {
            _logger?.LogError(ex, "Corrupt session file at {Path}", path);
            throw new InvalidDataException($"Session file for id '{id}' is corrupt.", ex);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<TradingSessionSummary>> ListSessionsAsync(
        CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_rootPath);

        var files = Directory.GetFiles(_rootPath, "*.json");
        var summaries = new List<TradingSessionSummary>(files.Length);

        await _gate.WaitAsync(cancellationToken);
        try
        {
            foreach (var file in files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    await using var stream = File.OpenRead(file);
                    var session = await JsonSerializer.DeserializeAsync<TradingSession>(
                        stream,
                        SerializerOptions,
                        cancellationToken);
                    if (session is null || string.IsNullOrWhiteSpace(session.Id))
                    {
                        continue;
                    }

                    summaries.Add(ToSummary(session));
                }
                catch (JsonException ex)
                {
                    _logger?.LogWarning(ex, "Skipping corrupt session file {File}", file);
                }
            }
        }
        finally
        {
            _gate.Release();
        }

        return summaries
            .OrderByDescending(s => s.UpdatedAt)
            .ToList();
    }

    internal string ResolvePath(string id)
    {
        var safeId = SanitizePathSegment(id);
        return Path.Combine(_rootPath, $"{safeId}.json");
    }

    private static TradingSessionSummary ToSummary(TradingSession session) =>
        new()
        {
            Id = session.Id,
            CreatedAt = session.CreatedAt,
            UpdatedAt = session.UpdatedAt,
            Symbol = session.Symbol,
            ClosedTradeCount = session.ClosedTrades?.Count ?? 0,
            StartingBalance = session.StartingBalance
        };

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
