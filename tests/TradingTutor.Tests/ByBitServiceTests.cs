using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using TradingTutor.Trading.Services;
using Xunit;

namespace TradingTutor.Tests;

public class ByBitServiceTests
{
    [Fact]
    public async Task GetMarketDataAsync_MapsCannedKlinePayload_ToOldestFirstCandles()
    {
        const string payload = """
            {
              "retCode": 0,
              "retMsg": "OK",
              "result": {
                "symbol": "BTCUSDT",
                "list": [
                  ["1700003600000","101","103","100","102","12.5","0"],
                  ["1700000000000","95","100","94","99","10.5","0"]
                ]
              }
            }
            """;

        var handler = new StubHttpMessageHandler((request, _) =>
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Contains("/v5/market/kline", request.RequestUri!.AbsolutePath, StringComparison.Ordinal);
            Assert.Contains("category=spot", request.RequestUri.Query, StringComparison.Ordinal);
            Assert.Contains("symbol=BTCUSDT", request.RequestUri.Query, StringComparison.Ordinal);
            Assert.Contains("interval=60", request.RequestUri.Query, StringComparison.Ordinal);

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
        });

        using var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://api.bybit.com")
        };
        var service = new ByBitService(httpClient, NullLogger<ByBitService>.Instance);

        var candles = await service.GetMarketDataAsync("BTCUSDT", "1h", limit: 2);

        Assert.Equal(2, candles.Count);

        var first = candles[0];
        Assert.Equal("BTCUSDT", first.Symbol);
        Assert.Equal("ByBit", first.Exchange);
        Assert.Equal("1h", first.Interval);
        Assert.Equal(new DateTime(2023, 11, 14, 22, 13, 20, DateTimeKind.Utc), first.Timestamp);
        Assert.Equal(95m, first.Open);
        Assert.Equal(100m, first.High);
        Assert.Equal(94m, first.Low);
        Assert.Equal(99m, first.Close);
        Assert.Equal(10.5m, first.Volume);

        var second = candles[1];
        Assert.Equal(new DateTime(2023, 11, 14, 23, 13, 20, DateTimeKind.Utc), second.Timestamp);
        Assert.Equal(101m, second.Open);
        Assert.Equal(102m, second.Close);
    }

    [Fact]
    public async Task GetMarketDataAsync_SkipsMalformedKlineRow_AndKeepsValidCandles()
    {
        const string payload = """
            {
              "retCode": 0,
              "retMsg": "OK",
              "result": {
                "symbol": "BTCUSDT",
                "list": [
                  ["1700003600000","101","103","100","102","12.5","0"],
                  ["not-a-timestamp","95","100","94","99","10.5","0"],
                  ["1700000000000","95","100","94","99","10.5","0"]
                ]
              }
            }
            """;

        var handler = new StubHttpMessageHandler((_, _) =>
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            });

        using var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://api.bybit.com")
        };
        var service = new ByBitService(httpClient, NullLogger<ByBitService>.Instance);

        var candles = await service.GetMarketDataAsync("BTCUSDT", "1h", limit: 3);

        Assert.Equal(2, candles.Count);
        Assert.Equal(new DateTime(2023, 11, 14, 22, 13, 20, DateTimeKind.Utc), candles[0].Timestamp);
        Assert.Equal(new DateTime(2023, 11, 14, 23, 13, 20, DateTimeKind.Utc), candles[1].Timestamp);
    }

    [Theory]
    [InlineData("1m", "1")]
    [InlineData("1h", "60")]
    [InlineData("4h", "240")]
    [InlineData("1d", "D")]
    [InlineData("1M", "M")]
    public void ToByBitInterval_MapsCommonLabels(string input, string expected)
    {
        Assert.Equal(expected, IntervalParser.ToByBitInterval(input));
    }

    [Fact]
    public void ToByBitInterval_Unknown_Throws()
    {
        Assert.Throws<CandleLoadValidationException>(() => IntervalParser.ToByBitInterval("xyz"));
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
