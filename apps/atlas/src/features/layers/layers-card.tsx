import type { Job } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { ClockIcon, EyeIcon, EyeOffIcon, PlusIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { datasetQueries } from "@/api/datasets";
import { jobQueries } from "@/api/jobs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { Area } from "@/features/area/area";
import { AddDataSheet } from "@/features/datasets/add-data-sheet";
import { WorkspaceCard } from "@/features/workspace/workspace-card";
import { cn } from "@/lib/utils";
import { layerColor } from "./layer-color";
import { LayerDetailsSheet } from "./layer-details-sheet";
import { LayerMenu } from "./layer-menu";
import { useLayerActions, useLayerSettings } from "./layer-store";
import { useAreaLayers } from "./use-area-layers";
import { useLayerGeometry } from "./use-layer-geometry";

// One sheet at a time opens over the map.
type Panel = { kind: "add-data" } | { kind: "details"; job: Job } | null;

/**
 * The selected area's layers, top first: each job run on it, with its progress until its result is ready. Owns
 * the sheets it opens, so unselecting the area closes them.
 */
export function LayersCard({ area }: { area: Area }) {
  const [panel, setPanel] = useState<Panel>(null);
  const jobs = useQuery(jobQueries.list());
  const datasets = useQuery(datasetQueries.list());
  const layers = useAreaLayers(area);
  const titles = new Map(datasets.data?.items.map((dataset) => [dataset.name, dataset.title]));
  const layerIds = layers.map((job) => job.id);

  return (
    <WorkspaceCard
      title="Layers"
      action={
        <Button
          size="sm"
          onClick={() => {
            setPanel({ kind: "add-data" });
          }}
        >
          <PlusIcon />
          Add data
        </Button>
      }
    >
      {jobs.isPending && <Spinner />}
      {jobs.isError && <p className="text-destructive">Couldn't load the jobs: {jobs.error.message}</p>}
      {jobs.isSuccess && layers.length === 0 && (
        <p className="text-muted-foreground">Nothing yet. Add data to run a Dataset on this area.</p>
      )}
      <ul className="flex flex-col gap-2">
        {layers.map((job) => (
          <li key={job.id}>
            <LayerRow
              job={job}
              title={titles.get(job.dataset) ?? job.dataset}
              layerIds={layerIds}
              onDetails={() => {
                setPanel({ kind: "details", job });
              }}
            />
          </li>
        ))}
      </ul>
      <AddDataSheet
        open={panel?.kind === "add-data"}
        onOpenChange={(open) => {
          setPanel(open ? { kind: "add-data" } : null);
        }}
      />
      <LayerDetailsSheet
        job={panel?.kind === "details" ? panel.job : null}
        onClose={() => {
          setPanel(null);
        }}
      />
    </WorkspaceCard>
  );
}

type LayerRowProps = { job: Job; title: string; layerIds: string[]; onDetails: () => void };

function LayerRow({ job, title, layerIds, onDetails }: LayerRowProps) {
  const { artifact, extent } = useLayerGeometry(job);
  const { visible } = useLayerSettings(job.id);
  const { toggleVisible } = useLayerActions();
  const drawable = job.state === "completed" && artifact !== null;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-2">
      <div className="flex items-center gap-1.5">
        {job.state === "completed" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!drawable}
            aria-pressed={drawable && visible}
            aria-label={visible ? `Hide ${title}` : `Show ${title}`}
            onClick={() => {
              toggleVisible(job.id);
            }}
          >
            {drawable && visible ? <EyeIcon /> : <EyeOffIcon />}
          </Button>
        ) : (
          <span className="flex size-7 items-center justify-center">
            <StateIcon state={job.state} />
          </span>
        )}
        <span
          aria-hidden
          className={cn("size-3 shrink-0 rounded-sm", !drawable && "opacity-30")}
          style={{ backgroundColor: layerColor(job.id) }}
        />
        <span className={cn("flex-1 truncate font-medium", drawable && !visible && "text-muted-foreground")}>
          {title}
        </span>
        <LayerMenu job={job} title={title} areaLayerIds={layerIds} extent={extent} onDetails={onDetails} />
      </div>
      <LayerStatus job={job} drawable={drawable} />
    </div>
  );
}

function StateIcon({ state }: { state: Job["state"] }) {
  switch (state) {
    case "queued":
      return <ClockIcon className="size-4 text-muted-foreground" aria-label="Queued" />;
    case "running":
      return <Spinner className="size-4" aria-label="Running" />;
    case "failed":
      return <XCircleIcon className="size-4 text-destructive" aria-label="Failed" />;
    case "completed":
      return null;
  }
}

// Only what Core measured: without a measurement the bar moves but shows no percentage.
function LayerStatus({ job, drawable }: { job: Job; drawable: boolean }) {
  switch (job.state) {
    case "queued":
      return <p className="pl-8 text-xs text-muted-foreground">Waiting for the engine</p>;
    case "running":
      return (
        <div className="flex flex-col gap-1 pl-8">
          <Progress
            value={job.progress?.percent ?? null}
            aria-label={`${job.dataset} progress`}
            className="**:data-indeterminate:w-full **:data-indeterminate:animate-pulse"
          />
          <p className="flex text-xs text-muted-foreground">
            <span className="flex-1 truncate">{job.progress?.message ?? "Running…"}</span>
            {job.progress && <span className="tabular-nums">{Math.round(job.progress.percent)}%</span>}
          </p>
        </div>
      );
    case "completed":
      return drawable ? null : (
        <p className="pl-8 text-xs text-muted-foreground">Can't be drawn on the map yet; see its details.</p>
      );
    case "failed":
      return <p className="pl-8 text-xs text-destructive">{job.error ?? "Failed"}</p>;
  }
}
