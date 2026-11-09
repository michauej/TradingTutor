namespace TradingTutor.Coaching.Llm;

public interface ILmStudioClient
{
    /// <summary>
    /// Calls chat completions and returns raw assistant text.
    /// Throws <see cref="LmStudioException"/> on upstream failures.
    /// </summary>
    Task<string> CompleteChatAsync(
        string systemPrompt,
        string userPrompt,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Upstream LM Studio / OpenAI-compatible failure (maps to HTTP 502 at the controller).
/// </summary>
public sealed class LmStudioException : Exception
{
    public LmStudioException(string message, Exception? inner = null)
        : base(message, inner)
    {
    }
}
