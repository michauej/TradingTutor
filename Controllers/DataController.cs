using Microsoft.AspNetCore.Mvc;
using TradingTutor.Services;

namespace TradingTutor.Controllers;

[ApiController]
[Route("api/data")]
public class DataController : ControllerBase
{
    private readonly IExchangeService _exchangeService;

    public DataController(IExchangeService exchangeService)
    {
        _exchangeService = exchangeService;
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
        catch (Exception ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status502BadGateway,
                title: "Failed to fetch ByBit candles");
        }
    }
}
