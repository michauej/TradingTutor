using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TradingTutor.Coaching;
using TradingTutor.Coaching.Llm;
using Xunit;

namespace TradingTutor.Tests;

public class LmStudioClientTests
{
    [Fact]
    public async Task CompleteChatAsync_MapsAssistantContent_AndPostsExpectedPath()
    {
        const string payload = """
            {
              "choices": [
                {
                  "message": {
                    "role": "assistant",
                    "content": "VERDICT: Good\nANALYSIS: Details here"
                  }
                }
              ]
            }
            """;

        var handler = new StubHttpMessageHandler((request, _) =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.EndsWith("/chat/completions", request.RequestUri!.AbsolutePath, StringComparison.Ordinal);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
        });

        using var http = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://127.0.0.1:1234/v1/")
        };
        var client = new LmStudioClient(
            http,
            Options.Create(new CoachOptions { Model = "test-model" }),
            NullLogger<LmStudioClient>.Instance);

        var text = await client.CompleteChatAsync("sys", "user");
        Assert.Contains("VERDICT: Good", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CompleteChatAsync_NonOkStatus_ThrowsLmStudioException()
    {
        var handler = new StubHttpMessageHandler((_, _) =>
            new HttpResponseMessage(HttpStatusCode.BadGateway)
            {
                Content = new StringContent("nope", Encoding.UTF8, "text/plain")
            });

        using var http = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://127.0.0.1:1234/v1/")
        };
        var client = new LmStudioClient(
            http,
            Options.Create(new CoachOptions { Model = "test-model" }),
            NullLogger<LmStudioClient>.Instance);

        await Assert.ThrowsAsync<LmStudioException>(
            () => client.CompleteChatAsync("sys", "user"));
    }

    [Theory]
    [InlineData("VERDICT: A\nANALYSIS: B", "A", "B")]
    [InlineData("no markers at all", "Coach reply", "no markers at all")]
    public void CoachResponseParser_SplitsMarkers(string input, string verdict, string analysis)
    {
        var (v, a) = CoachResponseParser.Parse(input);
        Assert.Equal(verdict, v);
        Assert.Equal(analysis, a);
    }

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> _responder;

        public StubHttpMessageHandler(
            Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> responder)
        {
            _responder = responder;
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(_responder(request, cancellationToken));
    }
}
