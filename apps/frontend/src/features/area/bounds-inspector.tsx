import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FloatingCard } from "@/components/floating-card";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { TextField } from "@/features/auth/text-field";
import { areaSquareMetres, formatSquareMetres, type Area } from "./area";
import { useAreaStore } from "./area-store";
import { boundsSchema, toBoundsFields } from "./bounds-form";

/** The area's bounds in degrees, to read or type. */
export function BoundsInspector({ onClose }: { onClose: () => void }) {
  const area = useAreaStore((state) => state.area);
  const { setArea } = useAreaStore((state) => state.actions);
  // Follows the area as it is drawn, moved or resized.
  const form = useForm({ resolver: zodResolver(boundsSchema), values: toBoundsFields(area) });

  function submit(next: Area) {
    setArea(next);
  }

  const size = area ? formatSquareMetres(areaSquareMetres(area)) : "No area yet";

  return (
    <FloatingCard title="Area bounds" onClose={onClose}>
      <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate>
        <FieldGroup>
          <p className="text-sm text-muted-foreground">Decimal degrees, WGS84</p>
          <div className="grid grid-cols-2 gap-3">
            <TextField control={form.control} name="north" label="North" />
            <TextField control={form.control} name="east" label="East" />
            <TextField control={form.control} name="south" label="South" />
            <TextField control={form.control} name="west" label="West" />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">{size}</p>
          <FieldError errors={[form.formState.errors.root]} />
          <Button type="submit">Set area</Button>
        </FieldGroup>
      </form>
    </FloatingCard>
  );
}
