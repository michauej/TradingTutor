using Microsoft.Extensions.Options;
using TradingTutor.Coaching;
using TradingTutor.Coaching.Llm;
using TradingTutor.Coaching.Rules;
using TradingTutor.Trading.Interfaces;
using TradingTutor.Trading.Options;
using TradingTutor.Trading.Services;
using TradingTutor.Trading.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddControllers();
builder.Services.AddHttpClient<IExchangeService, ByBitService>();

builder.Services.Configure<CandleStorageOptions>(
    builder.Configuration.GetSection(CandleStorageOptions.SectionName));
builder.Services.AddSingleton<ICandlePackRepository, JsonCandlePackRepository>();
builder.Services.AddScoped<ICandleLoadService, CandleLoadService>();


builder.Services.Configure<CoachOptions>(builder.Configuration.GetSection(CoachOptions.SectionName));
builder.Services.AddSingleton<FixedRulePack>();
builder.Services.AddSingleton<LectureContextLoader>();
builder.Services.AddScoped<CoachAnalyzeService>();
builder.Services.AddHttpClient<ILmStudioClient, LmStudioClient>((sp, client) =>
{
    var opts = sp.GetRequiredService<IOptions<CoachOptions>>().Value;
    var baseUrl = opts.BaseUrl.TrimEnd('/') + "/";
    client.BaseAddress = new Uri(baseUrl);
    client.Timeout = TimeSpan.FromSeconds(Math.Clamp(opts.TimeoutSeconds, 5, 120));
});

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseHttpsRedirection();
app.MapControllers();

app.Run();
