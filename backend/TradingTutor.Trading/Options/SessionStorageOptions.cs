namespace TradingTutor.Trading.Options;

public class SessionStorageOptions
{
    public const string SectionName = "SessionStorage";

    public string RootPath { get; set; } = "data/sessions";
}
