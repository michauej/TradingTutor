using TradingTutor.API.Middleware;
using TradingTutor.Trading.Services;
using Xunit;

namespace TradingTutor.Tests;

public class ExceptionHandlingMiddlewareTests
{
    [Fact]
    public void Map_SessionNotFound_Returns404()
    {
        var (status, title, _, _) = ExceptionHandlingMiddleware.Map(new SessionNotFoundException("abc"));
        Assert.Equal(404, status);
        Assert.Equal("Session not found", title);
    }

    [Fact]
    public void Map_CandleLoadValidation_Returns400()
    {
        var (status, title, detail, _) =
            ExceptionHandlingMiddleware.Map(new CandleLoadValidationException("bad interval"));
        Assert.Equal(400, status);
        Assert.Equal("Invalid request", title);
        Assert.Equal("bad interval", detail);
    }

    [Fact]
    public void Map_CandleLoadExchange_Returns502()
    {
        var (status, title, _, logAsError) =
            ExceptionHandlingMiddleware.Map(new CandleLoadExchangeException("down"));
        Assert.Equal(502, status);
        Assert.Equal("Failed to load candles", title);
        Assert.True(logAsError);
    }
}
