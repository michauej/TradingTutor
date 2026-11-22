using Microsoft.AspNetCore.Mvc;
using TradingTutor.Core.Models;
using TradingTutor.Trading.Services;

namespace TradingTutor.API.Controllers;

[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly SessionService _sessions;
    private readonly ILogger<SessionsController> _logger;

    public SessionsController(SessionService sessions, ILogger<SessionsController> logger)
    {
        _sessions = sessions;
        _logger = logger;
    }

    /// <summary>Create or overwrite a full session snapshot by id.</summary>
    [HttpPost]
    public async Task<IActionResult> CreateSession(
        [FromBody] TradingSession? session,
        CancellationToken cancellationToken = default)
    {
        if (session is null)
        {
            return Problem(
                detail: "Request body must be a session snapshot.",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }

        try
        {
            var saved = await _sessions.CreateAsync(session, cancellationToken);
            return Ok(new
            {
                id = saved.Id,
                createdAt = saved.CreatedAt,
                updatedAt = saved.UpdatedAt
            });
        }
        catch (ArgumentException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create session {SessionId}", session.Id);
            return Problem(
                detail: "Failed to persist session.",
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Session save failed");
        }
    }

    /// <summary>List session summaries (newest updated first).</summary>
    [HttpGet]
    public async Task<IActionResult> ListSessions(CancellationToken cancellationToken = default)
    {
        try
        {
            var list = await _sessions.ListAsync(cancellationToken);
            return Ok(list);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list sessions");
            return Problem(
                detail: "Failed to list sessions.",
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Session list failed");
        }
    }

    /// <summary>Full session by id.</summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetSession(
        string id,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return Problem(
                detail: "Session id is required.",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }

        try
        {
            var session = await _sessions.GetAsync(id, cancellationToken);
            if (session is null)
            {
                return NotFound();
            }

            return Ok(session);
        }
        catch (InvalidDataException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Corrupt session");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get session {SessionId}", id);
            return Problem(
                detail: "Failed to load session.",
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Session load failed");
        }
    }
}
