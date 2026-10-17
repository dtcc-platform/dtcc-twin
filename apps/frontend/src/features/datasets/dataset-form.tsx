import { zodResolver } from "@hookform/resolvers/zod";
import type { Dataset } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { authQueries } from "@/api/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { areaBounds } from "@/features/area/area";
import { useAreaStore } from "@/features/area/area-store";
import { DatasetFieldControl } from "./dataset-field-control.tsx";
import { datasetFields } from "./dataset-fields.ts";
import { initialValues, jobParameters, valuesSchema, type DatasetFormValues } from "./dataset-values.ts";

/** A Dataset's parameters, generated from its argsSchema, to run it on the area. */
export function DatasetForm({ dataset }: { dataset: Dataset }) {
  const { fields, omitted } = useMemo(() => datasetFields(dataset.argsSchema), [dataset.argsSchema]);
  const form = useForm<DatasetFormValues>({
    resolver: zodResolver(valuesSchema(fields)),
    defaultValues: initialValues(fields),
  });
  const me = useQuery(authQueries.me());
  const area = useAreaStore((state) => state.area);

  // Until the job is submitted (step 8 of docs/datasets-plan.md), Run shows the parameters it would send.
  function submit(values: DatasetFormValues) {
    if (!area) return;
    toast.info("Parameters for this job", {
      description: JSON.stringify(jobParameters(fields, values, areaBounds(area))),
    });
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate>
      <FieldGroup className="gap-5">
        {fields.map((field) => (
          <DatasetFieldControl key={field.name} control={form.control} field={field} />
        ))}
        {omitted.length > 0 && <p className="text-xs text-muted-foreground">Uses the default: {omitted.join(", ")}</p>}
        <FieldError errors={[form.formState.errors.root]} />
        {!area && <p className="text-sm text-muted-foreground">Draw an area on the map first</p>}
        {me.data === null ? (
          <Link to="/" search={{ auth: "login" }} className={buttonVariants()}>
            Log in to run
          </Link>
        ) : (
          <Button type="submit" disabled={!area || me.isPending}>
            Run
          </Button>
        )}
      </FieldGroup>
    </form>
  );
}
