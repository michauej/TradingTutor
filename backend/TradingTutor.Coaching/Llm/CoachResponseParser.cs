namespace TradingTutor.Coaching.Llm;

/// <summary>
/// Splits assistant text on VERDICT: / ANALYSIS: section markers.
/// If markers are missing, the whole text is treated as Analysis and Verdict is a short fallback.
/// </summary>
public static class CoachResponseParser
{
    public static (string Verdict, string Analysis) Parse(string assistantText)
    {
        ArgumentNullException.ThrowIfNull(assistantText);
        var text = assistantText.Trim();
        if (text.Length == 0)
        {
            return ("Unavailable", "The coach model returned an empty reply.");
        }

        var verdictIdx = IndexOfMarker(text, "VERDICT:");
        var analysisIdx = IndexOfMarker(text, "ANALYSIS:");

        if (verdictIdx < 0 && analysisIdx < 0)
        {
            return ("Coach reply", text);
        }

        string verdict;
        string analysis;

        if (verdictIdx >= 0 && analysisIdx >= 0)
        {
            if (verdictIdx < analysisIdx)
            {
                verdict = text[(verdictIdx + "VERDICT:".Length)..analysisIdx].Trim();
                analysis = text[(analysisIdx + "ANALYSIS:".Length)..].Trim();
            }
            else
            {
                analysis = text[(analysisIdx + "ANALYSIS:".Length)..verdictIdx].Trim();
                verdict = text[(verdictIdx + "VERDICT:".Length)..].Trim();
            }
        }
        else if (verdictIdx >= 0)
        {
            verdict = text[(verdictIdx + "VERDICT:".Length)..].Trim();
            analysis = string.Empty;
        }
        else
        {
            verdict = "Coach reply";
            analysis = text[(analysisIdx + "ANALYSIS:".Length)..].Trim();
        }

        if (string.IsNullOrWhiteSpace(verdict))
        {
            verdict = "Coach reply";
        }

        return (verdict, analysis);
    }

    private static int IndexOfMarker(string text, string marker)
        => text.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
}
