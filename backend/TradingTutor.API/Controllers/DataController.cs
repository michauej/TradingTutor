using Microsoft.AspNetCore.Mvc;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.API.Controllers;

[ApiController]
[Route("api/data")]
public class DataController : ControllerBase
{
    private readonly IExchangeService _exchangeService;
    private readonly ILogger<DataController> _logger;

    public DataController(IExchangeService exchangeService, ILogger<DataController> logger)
    {
        _exchangeService = exchangeService;
        _logger = logger;
    }

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
}
