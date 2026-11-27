using TradingTutor.Trading.Services;
using Xunit;

namespace TradingTutor.Tests;

public class IntervalParserTests
{
    [Theory]
    [InlineData("1m", 60_000)]
    [InlineData("1", 60_000)]
    [InlineData("5m", 5 * 60_000)]
    [InlineData("5", 5 * 60_000)]
    [InlineData("15m", 15 * 60_000)]
    [InlineData("15", 15 * 60_000)]
    [InlineData("1h", 60 * 60_000)]
    [InlineData("60", 60 * 60_000)]
    [InlineData("4h", 4 * 60 * 60_000)]
    [InlineData("240", 4 * 60 * 60_000)]
    [InlineData("1d", 24 * 60 * 60_000)]
    [InlineData("d", 24 * 60 * 60_000)]
    [InlineData("1M", 30 * 24 * 60 * 60_000d)]
    [InlineData("M", 30 * 24 * 60 * 60_000d)]
    public void ToDurationMs_MapsCommonLabelsAndNumericAliases(string input, double expectedMs)
    {
        Assert.Equal(expectedMs, IntervalParser.ToDurationMs(input));
    }

    [Theory]
    [InlineData("1m", "1")]
    [InlineData("1", "1")]
    [InlineData("1h", "60")]
    [InlineData("60", "60")]
    [InlineData("4h", "240")]
    [InlineData("240", "240")]
    [InlineData("1d", "D")]
    [InlineData("1M", "M")]
    [InlineData("M", "M")]
    public void ToByBitInterval_MapsCommonLabels(string input, string expected)
    {
        Assert.Equal(expected, IntervalParser.ToByBitInterval(input));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("2m")]
    [InlineData("xyz")]
    public void UnknownOrBlank_ThrowsCandleLoadValidationException(string input)
    {
        Assert.Throws<CandleLoadValidationException>(() => IntervalParser.ToDuration(input));
        Assert.Throws<CandleLoadValidationException>(() => IntervalParser.ToDurationMs(input));
        Assert.Throws<CandleLoadValidationException>(() => IntervalParser.ToByBitInterval(input));
    }
}
