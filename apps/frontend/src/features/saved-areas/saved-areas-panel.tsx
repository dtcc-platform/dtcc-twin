import { zodResolver } from "@hookform/resolvers/zod";
import { createSavedAreaBodySchema, type SavedArea } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useMap } from "react-map-gl/maplibre";
import { toast } from "sonner";
import { authQueries } from "@/api/auth";
import { savedAreaMutations, savedAreaQueries } from "@/api/saved-areas";
import { ConfirmButton } from "@/components/common/confirm-button";
import { FloatingCard } from "@/components/common/floating-card";
import { TextField } from "@/components/common/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { areaSquareMetres, formatSquareMetres } from "@/features/area/area";
import { useAreaStore } from "@/features/area/area-store";
import { workspaceMapId } from "@/features/workspace/map/map-view";
import { formatRelativeTime } from "@/lib/relative-time";
import { showSubmitError } from "@/lib/show-submit-error";
import { defaultAreaName } from "./default-name.ts";

// The backend's largest page; more saved areas than this is not a case to design for yet.
const limit = 100;

/** The user's saved areas, the UI's bookmarks: save the area, load one back, delete one. */
export function SavedAreasPanel({ onClose }: { onClose: () => void }) {
  const me = useQuery(authQueries.me());

  return (
    <FloatingCard title="Bookmarks" onClose={onClose}>
      {me.isPending && <Spinner className="mx-auto my-4" />}
      {me.data === null && (
        <div className="flex flex-col items-start gap-3 text-sm">
          <p className="text-muted-foreground">Log in to save areas and come back to them.</p>
          <Link to="/" search={{ auth: "login" }} className={buttonVariants({ size: "sm" })}>
            Log in
          </Link>
        </div>
      )}
      {me.data && (
        <div className="flex flex-col gap-5">
          <SaveAreaForm />
          <SavedAreaList />
        </div>
      )}
    </FloatingCard>
  );
}

const nameSchema = createSavedAreaBodySchema.pick({ name: true });

function SaveAreaForm() {
  const area = useAreaStore((state) => state.area);
  const create = useMutation(savedAreaMutations.create());
  const form = useForm({ resolver: zodResolver(nameSchema), defaultValues: { name: defaultAreaName() } });

  function submit({ name }: { name: string }) {
    if (!area) return;
    create.mutate(
      { name, area },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} was saved.`);
          form.reset({ name: defaultAreaName() });
        },
        onError: (error) => showSubmitError(form.setError, error),
      },
    );
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate>
      <FieldGroup className="gap-3">
        <TextField control={form.control} name="name" label="Name" />
        <FieldError errors={[form.formState.errors.root]} />
        {!area && <p className="text-sm text-muted-foreground">Draw an area on the map to save it</p>}
        <Button type="submit" disabled={!area || create.isPending}>
          Save area
        </Button>
      </FieldGroup>
    </form>
  );
}

function SavedAreaList() {
  const savedAreas = useQuery(savedAreaQueries.list({ limit }));

  if (savedAreas.isPending) return <Spinner className="mx-auto my-4" />;
  if (savedAreas.isError) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="text-destructive">{savedAreas.error.message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void savedAreas.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (savedAreas.data.items.length === 0) return <p className="text-sm text-muted-foreground">No bookmarks yet</p>;

  return (
    <ul className="-mx-2 flex flex-col">
      {savedAreas.data.items.map((savedArea) => (
        <SavedAreaItem key={savedArea.id} savedArea={savedArea} />
      ))}
    </ul>
  );
}

function SavedAreaItem({ savedArea }: { savedArea: SavedArea }) {
  const { setArea } = useAreaStore((state) => state.actions);
  const map = useMap()[workspaceMapId];
  const remove = useMutation(savedAreaMutations.delete());
  const { west, south, east, north } = savedArea.area;

  function load() {
    setArea(savedArea.area);
    map?.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 80 },
    );
  }

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={load}
      >
        <span className="block truncate text-sm font-medium">{savedArea.name}</span>
        <span className="text-xs text-muted-foreground">
          {formatSquareMetres(areaSquareMetres(savedArea.area))} · {formatRelativeTime(savedArea.createdAt)}
        </span>
      </button>
      <ConfirmButton
        label="Delete"
        variant="ghost"
        title={`Delete ${savedArea.name}?`}
        description="The bookmark is removed for good. The area on the map stays as it is."
        disabled={remove.isPending}
        onConfirm={() => {
          remove.mutate(savedArea.id, { onError: (error) => toast.error(error.message) });
        }}
      />
    </li>
  );
}
