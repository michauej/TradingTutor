using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace TradingTutor.Coaching.Llm;

/// <summary>
/// OpenAI-compatible chat completions client for local LM Studio.
/// Response contract expected from the model (documented for prompt + parser):
/// assistant text MUST contain markers:
///   VERDICT: &lt;one-line or short paragraph&gt;
///   ANALYSIS: &lt;longer coaching text&gt;
/// Parsing is performed by <see cref="CoachResponseParser"/>.
/// </summary>
public sealed class LmStudioClient : ILmStudioClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _httpClient;
    private readonly CoachOptions _options;
    private readonly ILogger<LmStudioClient> _logger;

    public LmStudioClient(
        HttpClient httpClient,
        IOptions<CoachOptions> options,
        ILogger<LmStudioClient> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<string> CompleteChatAsync(
        string systemPrompt,
        string userPrompt,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(systemPrompt);
        ArgumentException.ThrowIfNullOrWhiteSpace(userPrompt);

        var body = new ChatCompletionRequest
        {
            Model = _options.Model,
            Messages =
            [
                new ChatMessage { Role = "system", Content = systemPrompt },
                new ChatMessage { Role = "user", Content = userPrompt }
            ],
            Temperature = 0.3
        };

        try
        {
            using var response = await _httpClient.PostAsJsonAsync(
                "chat/completions",
                body,
                JsonOptions,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning(
                    "LM Studio chat completions failed with {StatusCode}: {Body}",
                    (int)response.StatusCode,
                    Truncate(errorBody, 500));
                throw new LmStudioException(
                    $"LM Studio returned {(int)response.StatusCode} {response.ReasonPhrase}.");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            var parsed = await JsonSerializer.DeserializeAsync<ChatCompletionResponse>(
                stream,
                JsonOptions,
                cancellationToken);

            var content = parsed?.Choices?.FirstOrDefault()?.Message?.Content;
            if (string.IsNullOrWhiteSpace(content))
            {
                throw new LmStudioException("LM Studio returned an empty assistant message.");
            }

            return content;
        }
        catch (LmStudioException)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LM Studio request failed for model {Model}", _options.Model);
            throw new LmStudioException("Failed to reach LM Studio chat completions endpoint.", ex);
        }
    }

    private static string Truncate(string value, int max)
        => value.Length <= max ? value : value[..max];

    private sealed class ChatCompletionRequest
    {
        public string Model { get; set; } = string.Empty;
        public List<ChatMessage> Messages { get; set; } = [];
        public double Temperature { get; set; }
    }

    private sealed class ChatMessage
    {
        public string Role { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
    }

    private sealed class ChatCompletionResponse
    {
        public List<ChatChoice>? Choices { get; set; }
    }

    private sealed class ChatChoice
    {
        public ChatMessage? Message { get; set; }
    }
}
