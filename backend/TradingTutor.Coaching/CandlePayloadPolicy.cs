using TradingTutor.Core.Models;

namespace TradingTutor.Coaching;

/// <summary>
/// Caps and downsamples coach candle prefixes.
/// Policy: max <see cref="MaxBars"/> bars; when over limit, keep bars nearest trade entry/exit
/// times plus a uniform stride fill so ICT structure remains meaningful.
/// </summary>
public static class CandlePayloadPolicy
{
    public const int MaxBars = 1500;

    public sealed record ApplyResult(
        IReadOnlyList<CandleInput> Candles,
        string? Note);

    public static ApplyResult Apply(
        IReadOnlyList<CandleInput>? candles,
        IReadOnlyList<ClosedTradeInput> trades)
    {
        if (candles is null || candles.Count == 0)
        {
            return new ApplyResult([], null);
        }

        var ordered = candles
            .OrderBy(c => c.Timestamp)
            .ToList();

        if (ordered.Count <= MaxBars)
        {
            return new ApplyResult(ordered, null);
        }

        var keep = new HashSet<int>();
        var tradeTimes = new List<DateTime>();
        foreach (var t in trades)
        {
            tradeTimes.Add(t.EntryTime.ToUniversalTime());
            tradeTimes.Add(t.ExitTime.ToUniversalTime());
        }

        foreach (var time in tradeTimes)
        {
            keep.Add(NearestIndex(ordered, time));
            // Neighbors help structure around the fill.
            var idx = NearestIndex(ordered, time);
            if (idx > 0)
            {
                keep.Add(idx - 1);
            }

            if (idx < ordered.Count - 1)
            {
                keep.Add(idx + 1);
            }
        }

        // Always keep ends.
        keep.Add(0);
        keep.Add(ordered.Count - 1);

        var stride = Math.Max(1, (int)Math.Ceiling(ordered.Count / (double)MaxBars));
        for (var i = 0; i < ordered.Count; i += stride)
        {
            keep.Add(i);
        }

        // If still over cap (dense trade neighborhoods), thin by stride priority.
        var selected = keep.OrderBy(i => i).ToList();
        if (selected.Count > MaxBars)
        {
            var thinned = new List<int> { selected[0] };
            var step = (double)(selected.Count - 1) / (MaxBars - 1);
            for (var n = 1; n < MaxBars - 1; n++)
            {
                var idx = selected[(int)Math.Round(n * step)];
                if (idx != thinned[^1])
                {
                    thinned.Add(idx);
                }
            }

            if (thinned[^1] != selected[^1])
            {
                thinned.Add(selected[^1]);
            }

            selected = thinned;
        }

        var downsampled = selected.Select(i => ordered[i]).ToList();
        var note =
            $"Candle prefix downsampled from {ordered.Count} to {downsampled.Count} bars (max {MaxBars}); preferred bars near trade times plus uniform stride.";
        return new ApplyResult(downsampled, note);
    }

    private static int NearestIndex(IReadOnlyList<CandleInput> ordered, DateTime time)
    {
        var target = time.ToUniversalTime();
        var best = 0;
        var bestDelta = long.MaxValue;
        for (var i = 0; i < ordered.Count; i++)
        {
            var delta = Math.Abs((ordered[i].Timestamp.ToUniversalTime() - target).Ticks);
            if (delta < bestDelta)
            {
                bestDelta = delta;
                best = i;
            }
        }

        return best;
    }
}
