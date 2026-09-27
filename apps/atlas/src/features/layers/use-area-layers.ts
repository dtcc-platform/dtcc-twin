import type { Job } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { jobQueries } from "@/api/jobs";
import { swerefBounds, type Area } from "@/features/area/area";
import { useLayerOrder, useRemovedLayers } from "./layer-store";
import { arrangeLayers, jobsOnBounds } from "./layers";

/** The layers of an area, top first: the jobs run on its bounds, as arranged and without the removed ones. */
export function useAreaLayers(area: Area | null): Job[] {
  const jobs = useQuery(jobQueries.list());
  const order = useLayerOrder();
  const removed = useRemovedLayers();
  if (!area || !jobs.data) return [];
  return arrangeLayers(jobsOnBounds(jobs.data.items, swerefBounds(area)), order, removed);
}
