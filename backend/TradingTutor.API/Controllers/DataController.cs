using Microsoft.AspNetCore.Mvc;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Services;

namespace TradingTutor.API.Controllers;

[ApiController]
[Route("api/data")]
public class DataController : ControllerBase
{
    private readonly IExchangeService _exchangeService;
    private readonly ICandleLoadService _candleLoadService;
    private readonly ILogger<DataController> _logger;

    public DataController(
        IExchangeService exchangeService,
        ICandleLoadService candleLoadService,
        ILogger<DataController> logger)
    {
        _exchangeService = exchangeService;
        _candleLoadService = candleLoadService;
        _logger = logger;
    }

    /// <summary>
    /// Orchestrated local-first candle load. Optional <c>offset</c>/<c>limit</c> return a
    /// progressive pack page (~500) after the full range is ensured on disk.
    /// </summary>
    [HttpGet("candles")]
    public async Task<IActionResult> GetCandles(
        [FromQuery] string symbol = "BTCUSDT",
        [FromQuery] string interval = "1h",
        [FromQuery] DateTime? startTime = null,
        [FromQuery] DateTime? endTime = null,
        [FromQuery] bool refresh = false,
        [FromQuery] int? offset = null,
        [FromQuery] int? limit = null,
        CancellationToken cancellationToken = default)
    {
        if (startTime is null || endTime is null)
        {
            return Problem(
                detail: "startTime and endTime are required.",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }

        try
        {
            var result = await _candleLoadService.LoadAsync(
                symbol,
                interval,
                startTime.Value,
                endTime.Value,
                refresh,
                offset,
                limit,
                cancellationToken);

            return Ok(new CandleLoadResponse
            {
                Candles = result.Candles,
                Source = result.Source,
                Incomplete = result.Incomplete,
                Message = result.Message,
                Offset = result.Offset,
                TotalCount = result.TotalCount,
                HasMore = result.HasMore
            });
        }
        catch (CandleLoadValidationException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (ArgumentException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (CandleLoadExchangeException ex)
        {
            _logger.LogError(ex, "Candle load exchange failure for {Symbol} {Interval}", symbol, interval);
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status502BadGateway,
                title: "Failed to load candles");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected candle load failure for {Symbol} {Interval}", symbol, interval);
            return Problem(
                detail: "Failed to load candles.",
                statusCode: StatusCodes.Status502BadGateway,
                title: "Failed to load candles");
        }
    }

    /// <summary>Debug/single-page ByBit passthrough (≤1000 bars). Prefer GET /api/data/candles for Load.</summary>
    [HttpGet("bybit")]
    public async Task<IActionResult> GetByBitCandles(
        [FromQuery] string symbol = "BTCUSDT",
        [FromQuery] string interval = "1h",
        [FromQuery] DateTime? startTime = null,
        [FromQuery] DateTime? endTime = null,
        [FromQuery] int limit = 200,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var candles = await _exchangeService.GetMarketDataAsync(
                symbol,
                interval,
                startTime,
                endTime,
                limit,
                cancellationToken);

            return Ok(candles);
        }
        catch (ArgumentException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch ByBit candles for {Symbol} {Interval}", symbol, interval);
            return Problem(
                detail: "Failed to fetch market data from ByBit.",
                statusCode: StatusCodes.Status502BadGateway,
                title: "Failed to fetch ByBit candles");
        }
    }

    public sealed class CandleLoadResponse
    {
        public required IReadOnlyList<MarketData> Candles { get; init; }
        public required string Source { get; init; }
        public required bool Incomplete { get; init; }
        public string? Message { get; init; }
        public int Offset { get; init; }
        public int TotalCount { get; init; }
        public bool HasMore { get; init; }
    }
}
