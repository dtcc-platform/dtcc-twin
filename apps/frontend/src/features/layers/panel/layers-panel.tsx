import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { jobQueries } from "@/api/jobs";
import { FloatingCard } from "@/components/common/floating-card";
import { Button } from "@/components/ui/button";
import { layerStatus } from "../layer-status.ts";
import { useLayersStore, type ResultLayer } from "../layers-store.ts";

/** The results on the map, top first, each with its job's status. */
export function LayersPanel({ onClose }: { onClose: () => void }) {
  const layers = useLayersStore((state) => state.layers);

  return (
    <FloatingCard title="Layers" onClose={onClose}>
      {layers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing on the map yet. Run a Dataset with Add to area, and its result shows up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {layers.toReversed().map((layer) => (
            <LayerItem key={layer.jobId} layer={layer} />
          ))}
        </ul>
      )}
    </FloatingCard>
  );
}

function LayerItem({ layer }: { layer: ResultLayer }) {
  const job = useQuery(jobQueries.detail(layer.jobId));
  const { remove } = useLayersStore((state) => state.actions);

  return (
    <li className="flex items-center gap-3 rounded-xl border p-3">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: layer.color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{layer.title}</p>
        <p className="text-xs text-muted-foreground">{job.isError ? job.error.message : layerStatus(job.data)}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${layer.title} from the map`}
        onClick={() => {
          remove(layer.jobId);
        }}
      >
        <XIcon />
      </Button>
    </li>
  );
}
