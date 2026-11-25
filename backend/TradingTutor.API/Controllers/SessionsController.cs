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

    /// <summary>Start a server-owned session (metadata only).</summary>
    [HttpPost]
    public async Task<IActionResult> StartSession(
        [FromBody] StartSessionRequest? request,
        CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            return Problem(
                detail: "Request body must be a start session payload.",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }

        try
        {
            var saved = await _sessions.StartAsync(request, cancellationToken);
            return Ok(saved);
        }
        catch (SessionCommandException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start session");
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

    [HttpPost("{id}/advance")]
    public Task<IActionResult> Advance(
        string id,
        [FromBody] AdvanceSessionRequest? request,
        CancellationToken cancellationToken = default) =>
        ExecuteCommandAsync(
            id,
            request,
            (s, r, ct) => s.AdvanceAsync(id, r!, ct),
            "advance",
            cancellationToken);

    [HttpPost("{id}/open")]
    public Task<IActionResult> Open(
        string id,
        [FromBody] OpenSessionRequest? request,
        CancellationToken cancellationToken = default) =>
        ExecuteCommandAsync(
            id,
            request,
            (s, r, ct) => s.OpenAsync(id, r!, ct),
            "open",
            cancellationToken);

    [HttpPost("{id}/close")]
    public Task<IActionResult> Close(
        string id,
        [FromBody] CloseSessionRequest? request,
        CancellationToken cancellationToken = default) =>
        ExecuteCommandAsync(
            id,
            request,
            (s, r, ct) => s.CloseAsync(id, r!, ct),
            "close",
            cancellationToken);

    [HttpPost("{id}/orders")]
    public Task<IActionResult> PlaceOrder(
        string id,
        [FromBody] PlaceOrderRequest? request,
        CancellationToken cancellationToken = default) =>
        ExecuteCommandAsync(
            id,
            request,
            (s, r, ct) => s.PlaceOrderAsync(id, r!, ct),
            "place order",
            cancellationToken);

    [HttpPost("{id}/orders/{orderId}/cancel")]
    public async Task<IActionResult> CancelOrder(
        string id,
        string orderId,
        CancellationToken cancellationToken = default)
    {
        if (RequireSessionId(id) is { } badId)
        {
            return badId;
        }

        try
        {
            var session = await _sessions.CancelOrderAsync(id, orderId, cancellationToken);
            return Ok(session);
        }
        catch (SessionNotFoundException)
        {
            return NotFound();
        }
        catch (ArgumentException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (SessionCommandException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to cancel order on session {SessionId}", id);
            return Problem(
                detail: "Failed to cancel order.",
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Session command failed");
        }
    }

    [HttpPost("{id}/interval")]
    public Task<IActionResult> ReanchorInterval(
        string id,
        [FromBody] ReanchorIntervalRequest? request,
        CancellationToken cancellationToken = default) =>
        ExecuteCommandAsync(
            id,
            request,
            (s, r, ct) => s.ReanchorIntervalAsync(id, r!, ct),
            "reanchor interval",
            cancellationToken);

    [HttpPost("{id}/lock")]
    public async Task<IActionResult> Lock(
        string id,
        CancellationToken cancellationToken = default)
    {
        if (RequireSessionId(id) is { } badId)
        {
            return badId;
        }

        try
        {
            var session = await _sessions.LockAsync(id, cancellationToken);
            return Ok(session);
        }
        catch (SessionNotFoundException)
        {
            return NotFound();
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
            _logger.LogError(ex, "Failed to lock session {SessionId}", id);
            return Problem(
                detail: "Failed to lock session.",
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Session command failed");
        }
    }

    private async Task<IActionResult> ExecuteCommandAsync<TRequest>(
        string id,
        TRequest? request,
        Func<SessionService, TRequest, CancellationToken, Task<TradingSession>> action,
        string operation,
        CancellationToken cancellationToken)
    {
        if (RequireSessionId(id) is { } badId)
        {
            return badId;
        }

        if (request is null)
        {
            return Problem(
                detail: $"Request body is required for {operation}.",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }

        try
        {
            var session = await action(_sessions, request, cancellationToken);
            return Ok(session);
        }
        catch (SessionNotFoundException)
        {
            return NotFound();
        }
        catch (ArgumentException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (SessionCommandException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (CandleLoadValidationException ex)
        {
            return Problem(
                detail: ex.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to {Operation} session {SessionId}", operation, id);
            return Problem(
                detail: $"Failed to {operation} session.",
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Session command failed");
        }
    }

    private IActionResult? RequireSessionId(string id)
    {
        if (!string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        return Problem(
            detail: "Session id is required.",
            statusCode: StatusCodes.Status400BadRequest,
            title: "Invalid request");
    }
}
