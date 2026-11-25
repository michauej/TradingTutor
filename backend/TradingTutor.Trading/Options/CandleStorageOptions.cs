namespace TradingTutor.Trading.Options;

public class CandleStorageOptions
{
    public const string SectionName = "CandleStorage";

    public string RootPath { get; set; } = "data/candles";

    /// <summary>
    /// Bars per progressive FE pack page (chart loader). Not a hard range clamp —
    /// the server stores the full requested range in the pack file.
    /// </summary>
    public int PackPageSize { get; set; } = 500;
}
