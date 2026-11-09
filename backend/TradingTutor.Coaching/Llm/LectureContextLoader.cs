using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace TradingTutor.Coaching.Llm;

/// <summary>
/// Optional lecture folder context. Missing/empty/unreadable folder → empty string (Analyze still works).
/// Reads .txt / .md / .csv text files only; binary PDFs are skipped (no PDF parser in MVP).
/// Total concatenated text is capped to keep the prompt bounded.
/// </summary>
public sealed class LectureContextLoader
{
    public const int MaxTotalChars = 8_000;
    public const int MaxFileChars = 4_000;

    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt",
        ".md",
        ".csv"
    };

    private readonly CoachOptions _options;
    private readonly ILogger<LectureContextLoader> _logger;

    public LectureContextLoader(IOptions<CoachOptions> options, ILogger<LectureContextLoader> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public string Load()
    {
        var folder = _options.PdfFolder;
        if (string.IsNullOrWhiteSpace(folder))
        {
            return string.Empty;
        }

        try
        {
            if (!Directory.Exists(folder))
            {
                _logger.LogInformation("Coach PdfFolder '{Folder}' does not exist — omitting lecture context.", folder);
                return string.Empty;
            }

            var files = Directory.EnumerateFiles(folder)
                .Where(f => TextExtensions.Contains(Path.GetExtension(f)))
                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (files.Count == 0)
            {
                _logger.LogInformation(
                    "Coach PdfFolder '{Folder}' has no .txt/.md/.csv files — omitting lecture context.",
                    folder);
                return string.Empty;
            }

            var parts = new List<string>();
            var remaining = MaxTotalChars;
            foreach (var file in files)
            {
                if (remaining <= 0)
                {
                    break;
                }

                try
                {
                    var raw = File.ReadAllText(file);
                    var slice = raw.Length <= Math.Min(MaxFileChars, remaining)
                        ? raw
                        : raw[..Math.Min(MaxFileChars, remaining)];
                    parts.Add($"--- {Path.GetFileName(file)} ---\n{slice.Trim()}");
                    remaining -= slice.Length;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Skipping unreadable lecture file {File}", file);
                }
            }

            return string.Join("\n\n", parts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read Coach PdfFolder — omitting lecture context.");
            return string.Empty;
        }
    }
}
