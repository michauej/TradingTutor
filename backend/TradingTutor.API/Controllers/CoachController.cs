using Microsoft.AspNetCore.Mvc;
using TradingTutor.Coaching;
using TradingTutor.Core.Models;
using TradingTutor.Core.Observability;
using TradingTutor.Trading.Interfaces;

namespace TradingTutor.API.Controllers;

[ApiController]
[Route("api/coach")]
public class CoachController : ControllerBase
{
    private readonly CoachAnalyzeService _analyzeService;
    private readonly ISessionRepository _sessions;

    public CoachController(
        CoachAnalyzeService analyzeService,
        ISessionRepository sessions)
    {
        _analyzeService = analyzeService;
        _sessions = sessions;
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

        using var activity = TradingTutorActivitySources.Source.StartActivity("coach.analyze");
        activity?.SetTag("session.id", request.SessionId);

        var session = await _sessions.GetSessionAsync(request.SessionId, cancellationToken);
        if (session is null)
        {
            throw new KeyNotFoundException($"Session '{request.SessionId}' was not found.");
        }

        var result = await _analyzeService.AnalyzeTradesAsync(
            session.ClosedTrades,
            cancellationToken);

        session.CoachVerdict = result.Verdict;
        session.CoachAnalysis = result.Analysis;
        session.CoachFindings = result.Findings.ToList();
        session.CoachAnalyzedAt = DateTime.UtcNow;
        session.UpdatedAt = DateTime.UtcNow;
        await _sessions.CreateSessionAsync(session, cancellationToken);

        return Ok(result);
    }
}
