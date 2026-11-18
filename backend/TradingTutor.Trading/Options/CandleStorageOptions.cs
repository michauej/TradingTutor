namespace TradingTutor.Trading.Options;

public class CandleStorageOptions
{
    public const string SectionName = "CandleStorage";

    public string RootPath { get; set; } = "data/candles";

    public int MaxBarsPerLoad { get; set; } = 10_000;
}
