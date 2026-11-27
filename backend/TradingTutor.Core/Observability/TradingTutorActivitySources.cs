using System.Diagnostics;

namespace TradingTutor.Core.Observability;

public static class TradingTutorActivitySources
{
    public const string Name = "TradingTutor";

    public static readonly ActivitySource Source = new(Name);
}
