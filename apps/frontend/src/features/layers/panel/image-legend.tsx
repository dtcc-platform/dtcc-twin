import { useQuery } from "@tanstack/react-query";
import { jobQueries } from "@/api/jobs";
import { legendTitle, legendValue } from "./legend-text.ts";

// Core's colormaps as CSS gradients, from the lowest value to the highest.
const gradients: Record<string, string> = {
  viridis:
    "linear-gradient(to right, #440154, #482878, #3e4989, #31688e, #26828e, #1f9e89, #35b779, #6ece58, #b5de2b, #fde725)",
};

/** What an image result's colors stand for, from its lowest value to its highest. */
export function ImageLegend({ jobId }: { jobId: string }) {
  const metadata = useQuery(jobQueries.artifactMetadata(jobId));
  const legend = metadata.data?.legend;
  if (!legend) return null;

  const [low, high] = legend.valueRange;
  const gradient = gradients[legend.colormap];
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
      <p>{legendTitle(legend)}</p>
      {gradient && <div className="h-2 rounded-full" style={{ backgroundImage: gradient }} aria-hidden />}
      <div className="flex justify-between">
        <span>{legendValue(low)}</span>
        <span>{legendValue(high)}</span>
      </div>
    </div>
  );
}
