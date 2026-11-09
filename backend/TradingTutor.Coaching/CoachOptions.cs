namespace TradingTutor.Coaching;

/// <summary>
/// LM Studio / coach configuration bound from the <c>Coach</c> appsettings section.
/// </summary>
public sealed class CoachOptions
{
    public const string SectionName = "Coach";

    /// <summary>OpenAI-compatible base URL (e.g. http://127.0.0.1:1234/v1).</summary>
    public string BaseUrl { get; set; } = "http://127.0.0.1:1234/v1";

    /// <summary>Model id as shown in LM Studio.</summary>
    public string Model { get; set; } = "local-model";

    /// <summary>HttpClient timeout in seconds (NFR ~30s).</summary>
    public int TimeoutSeconds { get; set; } = 30;

    /// <summary>Optional lecture folder; missing/empty skips PDF/text context.</summary>
    public string? PdfFolder { get; set; }
}
