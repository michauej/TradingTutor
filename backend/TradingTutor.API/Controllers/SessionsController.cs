using Microsoft.AspNetCore.Mvc;
using TradingTutor.Core.Models;
using TradingTutor.Core.Observability;
using TradingTutor.Trading.Services;

namespace TradingTutor.API.Controllers;

[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly SessionService _sessions;

    public SessionsController(SessionService sessions)
    {
        _sessions = sessions;
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

        using var activity = TradingTutorActivitySources.Source.StartActivity("session.start");
        var saved = await _sessions.StartAsync(request, cancellationToken);
        return Ok(saved);
    }

    /// <summary>List session summaries (newest updated first).</summary>
    [HttpGet]
    public async Task<IActionResult> ListSessions(CancellationToken cancellationToken = default)
    {
        var list = await _sessions.ListAsync(cancellationToken);
        return Ok(list);
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

        var session = await _sessions.GetAsync(id, cancellationToken);
        if (session is null)
        {
            return NotFound();
        }

        return Ok(session);
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
            "session.advance",
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
            "session.open",
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
            "session.close",
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
            "session.place_order",
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

        using var activity = TradingTutorActivitySources.Source.StartActivity("session.cancel_order");
        activity?.SetTag("session.id", id);
        var session = await _sessions.CancelOrderAsync(id, orderId, cancellationToken);
        return Ok(session);
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
            "session.reanchor",
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

        using var activity = TradingTutorActivitySources.Source.StartActivity("session.lock");
        activity?.SetTag("session.id", id);
        var session = await _sessions.LockAsync(id, cancellationToken);
        return Ok(session);
    }

    private async Task<IActionResult> ExecuteCommandAsync<TRequest>(
        string id,
        TRequest? request,
        Func<SessionService, TRequest, CancellationToken, Task<TradingSession>> action,
        string activityName,
        CancellationToken cancellationToken)
    {
        if (RequireSessionId(id) is { } badId)
        {
            return badId;
        }

        if (request is null)
        {
            return Problem(
                detail: $"Request body is required for {activityName}.",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid request");
        }

        using var activity = TradingTutorActivitySources.Source.StartActivity(activityName);
        activity?.SetTag("session.id", id);
        var session = await action(_sessions, request, cancellationToken);
        return Ok(session);
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
