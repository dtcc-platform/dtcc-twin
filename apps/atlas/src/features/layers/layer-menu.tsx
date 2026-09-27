import type { Job } from "@repo/contracts";
import { MoreHorizontalIcon } from "lucide-react";
import { useMap } from "react-map-gl/maplibre";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { atlasMapId } from "@/features/map/map-id";
import type { Extent } from "./geojson";
import { useLayerActions, useLayerSettings } from "./layer-store";

const opacities = [1, 0.75, 0.5, 0.25];

type LayerMenuProps = {
  job: Job;
  title: string;
  /** The area's layers, top first, for moving this one among them. */
  areaLayerIds: string[];
  /** Where the layer is on the map, once it's drawn. */
  extent: Extent | null;
  onDetails: () => void;
};

export function LayerMenu({ job, title, areaLayerIds, extent, onDetails }: LayerMenuProps) {
  const map = useMap()[atlasMapId];
  const { opacity } = useLayerSettings(job.id);
  const { setOpacity, move, remove } = useLayerActions();
  const position = areaLayerIds.indexOf(job.id);
  const completed = job.state === "completed";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${title} options`} />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {completed && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!extent}>Opacity</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={opacity}
                  onValueChange={(value: number) => {
                    setOpacity(job.id, value);
                  }}
                >
                  {opacities.map((value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {value * 100}%
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={!extent}
              onClick={() => {
                if (extent) map?.fitBounds(extent, { padding: 40 });
              }}
            >
              Zoom to layer
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem
          disabled={position <= 0}
          onClick={() => {
            move(areaLayerIds, job.id, "up");
          }}
        >
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={position === areaLayerIds.length - 1}
          onClick={() => {
            move(areaLayerIds, job.id, "down");
          }}
        >
          Move down
        </DropdownMenuItem>
        {completed && <DropdownMenuItem onClick={onDetails}>Details</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            remove(job.id);
          }}
        >
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
