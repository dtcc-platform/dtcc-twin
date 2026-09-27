import { ArrowLeftIcon, LocateFixedIcon, LockIcon, PencilIcon, PencilRulerIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAreaLayers } from "@/features/layers/use-area-layers";
import { atlasMapId } from "@/features/map/map-id";
import { WorkspaceCard } from "@/features/workspace/workspace-card";
import { areaFormSchema, areaSquareMetres, swerefBounds, type Area } from "./area";
import { AreaInspector } from "./area-inspector";
import { useAreaActions, useAreas, useDrawing, useSelectedArea, type SavedArea } from "./area-store";
import { DrawAreaButton } from "./draw-area-button";

/** The saved areas to pick from, or the selected one with its details. */
export function AreaCard() {
  const drawing = useDrawing();
  const selected = useSelectedArea();

  if (drawing) {
    return (
      <WorkspaceCard title="New area">
        <p className="text-muted-foreground">Click one corner on the map, then the opposite one.</p>
        <DrawAreaButton />
      </WorkspaceCard>
    );
  }
  if (selected) return <SelectedArea entry={selected} />;
  return <AreaList />;
}

function AreaList() {
  const map = useMap()[atlasMapId];
  const areas = useAreas();
  const { select, deleteArea } = useAreaActions();

  function open(entry: SavedArea) {
    select(entry.id);
    const { west, south, east, north } = entry.area;
    map?.fitBounds([west, south, east, north], { padding: 40 });
  }

  return (
    <WorkspaceCard title="Areas">
      {areas.length === 0 ? (
        <p className="text-muted-foreground">Start by drawing the area to work on, then add data to it.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {areas.map((entry) => (
            <li key={entry.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  open(entry);
                }}
                className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="truncate">{entry.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{squareKilometres(entry.area)} km²</span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${entry.name}`}
                onClick={() => {
                  deleteArea(entry.id);
                }}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <DrawAreaButton />
    </WorkspaceCard>
  );
}

function SelectedArea({ entry }: { entry: SavedArea }) {
  const { unselect, deleteArea } = useAreaActions();
  const layerCount = useAreaLayers(entry.area).length;
  const locked = layerCount > 0;
  const [editing, setEditing] = useState(false);
  const [minX, minY, maxX, maxY] = swerefBounds(entry.area);
  // A drawn box skips the inspector's form, so its size is checked here.
  const problem = areaFormSchema.safeParse(entry.area).error?.issues[0]?.message;

  return (
    <WorkspaceCard
      title="Area"
      action={
        <Button variant="ghost" size="sm" onClick={unselect}>
          <ArrowLeftIcon />
          All areas
        </Button>
      }
    >
      <AreaName entry={entry} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Size</dt>
        <dd className={problem ? "text-destructive" : undefined}>
          {squareKilometres(entry.area)} km²{problem && ` · ${problem}`}
        </dd>
        <dt className="text-muted-foreground">Layers</dt>
        <dd>{layerCount}</dd>
        <dt className="text-muted-foreground">EPSG:3006</dt>
        <dd className="font-mono">
          {minX}, {minY}
          <br />
          {maxX}, {maxY}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {locked && <LockedBadge />}
        {!locked && (
          <Button
            size="sm"
            variant={editing ? "secondary" : "outline"}
            aria-expanded={editing}
            onClick={() => {
              setEditing(!editing);
            }}
          >
            <PencilRulerIcon />
            Edit bounds
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            deleteArea(entry.id);
          }}
        >
          <Trash2Icon />
          Delete
        </Button>
      </div>
      {editing && !locked && (
        <AreaInspector
          area={entry.area}
          onApplied={() => {
            setEditing(false);
          }}
        />
      )}
    </WorkspaceCard>
  );
}

function LockedBadge() {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        <LockIcon />
        Locked
      </PopoverTrigger>
      <PopoverContent className="w-64 text-sm">
        The bounds can't change, since this area's layers were computed for them. Draw a new area for other bounds.
      </PopoverContent>
    </Popover>
  );
}

function AreaName({ entry }: { entry: SavedArea }) {
  const { rename } = useAreaActions();
  const [draft, setDraft] = useState<string | null>(null);
  // Escape unmounts the input, and a browser may fire blur as it goes; that blur must not save.
  const cancelled = useRef(false);

  if (draft === null) {
    return (
      <div className="flex items-center gap-1">
        <p className="truncate text-base font-medium">{entry.name}</p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Rename area"
          onClick={() => {
            cancelled.current = false;
            setDraft(entry.name);
          }}
        >
          <PencilIcon />
        </Button>
        <RecenterButton area={entry.area} />
      </div>
    );
  }

  function commit() {
    if (draft !== null && !cancelled.current) rename(entry.id, draft);
    setDraft(null);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <Input
        aria-label="Area name"
        autoFocus
        maxLength={60}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          cancelled.current = true;
          setDraft(null);
        }}
      />
    </form>
  );
}

function RecenterButton({ area }: { area: Area }) {
  const map = useMap()[atlasMapId];
  const { west, south, east, north } = area;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Recenter the map on this area"
      title="Recenter"
      className="ml-auto"
      onClick={() => {
        map?.fitBounds([west, south, east, north], { padding: 40 });
      }}
    >
      <LocateFixedIcon />
    </Button>
  );
}

function squareKilometres(area: Area): string {
  return (areaSquareMetres(area) / 1_000_000).toFixed(2);
}
