import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, type Control, type FieldErrors } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { areaFormSchema, type Area } from "./area";
import { useAreaActions } from "./area-store";

type AreaInspectorProps = { area: Area; onApplied: () => void };

/** The bounds inspector: the selected area's edges in degrees, to type exact values. */
export function AreaInspector({ area, onApplied }: AreaInspectorProps) {
  const { updateSelectedArea } = useAreaActions();

  function apply(edges: Area) {
    updateSelectedArea(edges);
    onApplied();
  }
  // `values` keeps the fields in step with the box as it's drawn, moved or resized.
  const form = useForm({ resolver: zodResolver(areaFormSchema), values: area });

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(apply)(event)}
      noValidate
      className="flex flex-col gap-3 rounded-lg bg-muted/60 p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <DegreeField control={form.control} name="north" label="North" />
        <DegreeField control={form.control} name="south" label="South" />
        <DegreeField control={form.control} name="west" label="West" />
        <DegreeField control={form.control} name="east" label="East" />
      </div>
      <FieldError errors={[wholeAreaError(form.formState.errors)]} />
      <Button type="submit" size="sm" className="w-fit">
        Apply
      </Button>
    </form>
  );
}

// trap: zodResolver files an issue about the whole object, such as its size, under the empty key.
function wholeAreaError(errors: FieldErrors<Area>): { message?: string } | undefined {
  return (errors as Record<string, { message?: string } | undefined>)[""];
}

type DegreeFieldProps = { control: Control<Area>; name: keyof Area; label: string };

function DegreeField({ control, name, label }: DegreeFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`area-${name}`}>{label}</FieldLabel>
          <Input
            id={`area-${name}`}
            type="number"
            step="any"
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={Number.isNaN(field.value) ? "" : field.value}
            onChange={(event) => {
              field.onChange(event.target.valueAsNumber);
            }}
            aria-invalid={fieldState.invalid}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
