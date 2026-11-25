using Microsoft.AspNetCore.Mvc;
using TradingTutor.Coaching;
using TradingTutor.Coaching.Llm;
using TradingTutor.Core.Models;

namespace TradingTutor.API.Controllers;

[ApiController]
[Route("api/coach")]
public class CoachController : ControllerBase
{
    private readonly CoachAnalyzeService _analyzeService;
    private readonly ILogger<CoachController> _logger;

    public CoachController(CoachAnalyzeService analyzeService, ILogger<CoachController> logger)
    {
        _analyzeService = analyzeService;
        _logger = logger;
    }

    [HttpPost("analyze")]
    public async Task<IActionResult> Analyze(
        [FromBody] CoachAnalyzeRequest? request,
        CancellationToken cancellationToken = default)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.SessionId))
        {
            return Problem(
                detail: "Request body must include a sessionId.",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }

        try
        {
            var result = await _analyzeService.AnalyzeBySessionAsync(
                request.SessionId,
                cancellationToken);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status404NotFound,
                title: "Session not found");
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
        catch (LmStudioException ex)
        {
            _logger.LogWarning(ex, "Coach analyze upstream LM failure for session {SessionId}",
                request.SessionId);
            return Problem(
                detail: "Failed to get coaching analysis from LM Studio.",
                statusCode: StatusCodes.Status502BadGateway,
                title: "Coach analysis failed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Coach analyze failed unexpectedly");
            return Problem(
                detail: "Failed to get coaching analysis from LM Studio.",
                statusCode: StatusCodes.Status502BadGateway,
                title: "Coach analysis failed");
        }
    }
}
