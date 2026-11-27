using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using TradingTutor.Coaching.Llm;
using TradingTutor.Trading.Services;

namespace TradingTutor.API.Middleware;

/// <summary>
/// Maps known domain exceptions to ProblemDetails with the same status codes
/// the controllers used before this middleware.
/// </summary>
public sealed class ExceptionHandlingMiddleware
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            await WriteProblemAsync(context, ex);
        }
    }

    public static (int Status, string Title, string Detail, bool LogAsError) Map(Exception ex) =>
        ex switch
        {
            SessionNotFoundException => (
                StatusCodes.Status404NotFound,
                "Session not found",
                "Session was not found.",
                false),
            KeyNotFoundException knf => (
                StatusCodes.Status404NotFound,
                "Session not found",
                knf.Message,
                false),
            ArgumentException arg => (
                StatusCodes.Status400BadRequest,
                "Invalid request",
                arg.Message,
                false),
            SessionCommandException cmd => (
                StatusCodes.Status400BadRequest,
                "Invalid request",
                cmd.Message,
                false),
            CandleLoadValidationException val => (
                StatusCodes.Status400BadRequest,
                "Invalid request",
                val.Message,
                false),
            LmStudioException lm => (
                StatusCodes.Status502BadGateway,
                "Coach analysis failed",
                "Failed to get coaching analysis from LM Studio.",
                false),
            CandleLoadExchangeException exchange => (
                StatusCodes.Status502BadGateway,
                "Failed to load candles",
                exchange.Message,
                true),
            _ => (
                StatusCodes.Status500InternalServerError,
                "Unexpected error",
                "An unexpected error occurred.",
                true)
        };

    private async Task WriteProblemAsync(HttpContext context, Exception ex)
    {
        var (status, title, detail, logAsError) = Map(ex);
        if (logAsError)
        {
            _logger.LogError(ex, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);
        }
        else if (ex is LmStudioException)
        {
            _logger.LogWarning(ex, "Upstream LM failure for {Method} {Path}", context.Request.Method, context.Request.Path);
        }

        if (context.Response.HasStarted)
        {
            throw ex;
        }

        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json";

        var problem = new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = detail
        };

        await context.Response.WriteAsync(JsonSerializer.Serialize(problem, JsonOptions));
    }
}
