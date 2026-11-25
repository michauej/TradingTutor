namespace TradingTutor.Trading.Services;

/// <summary>Validation / soft-cap / bad playhead failures for session commands (HTTP 400).</summary>
public sealed class SessionCommandException : Exception
{
    public SessionCommandException(string message) : base(message)
    {
    }
}

/// <summary>Session id not found (HTTP 404).</summary>
public sealed class SessionNotFoundException : Exception
{
    public SessionNotFoundException(string id)
        : base($"Session '{id}' was not found.")
    {
        SessionId = id;
    }

    public string SessionId { get; }
}
