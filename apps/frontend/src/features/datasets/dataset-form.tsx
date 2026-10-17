import { zodResolver } from "@hookform/resolvers/zod";
import type { Dataset } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { authQueries } from "@/api/auth";
import { jobMutations } from "@/api/jobs";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { areaBounds } from "@/features/area/area";
import { useAreaStore } from "@/features/area/area-store";
import { DatasetFieldControl } from "./dataset-field-control.tsx";
import { datasetFields } from "./dataset-fields.ts";
import { initialValues, jobParameters, valuesSchema, type DatasetFormValues } from "./dataset-values.ts";
import { submitErrors } from "./submit-errors.ts";

/** A Dataset's parameters, generated from its argsSchema, to run it on the area. */
export function DatasetForm({ dataset }: { dataset: Dataset }) {
  const { fields, omitted } = useMemo(() => datasetFields(dataset.argsSchema), [dataset.argsSchema]);
  const form = useForm<DatasetFormValues>({
    resolver: zodResolver(valuesSchema(fields)),
    defaultValues: initialValues(fields),
  });
  const me = useQuery(authQueries.me());
  const area = useAreaStore((state) => state.area);

  const create = useMutation(jobMutations.create());

  function submit(values: DatasetFormValues) {
    if (!area) return;
    const parameters = jobParameters(fields, values, areaBounds(area));
    create.mutate(
      { dataset: dataset.name, parameters },
      {
        onSuccess: () => toast.success("Job submitted", { description: dataset.title }),
        onError: (error) => {
          const errors = submitErrors(fields, error);
          for (const [name, message] of Object.entries(errors.fields)) form.setError(name, { message });
          if (errors.form.length > 0) form.setError("root", { message: errors.form.join("\n") });
        },
      },
    );
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate>
      <FieldGroup className="gap-5">
        {fields.map((field) => (
          <DatasetFieldControl key={field.name} control={form.control} field={field} />
        ))}
        {omitted.length > 0 && <p className="text-xs text-muted-foreground">Uses the default: {omitted.join(", ")}</p>}
        <FieldError errors={[form.formState.errors.root]} className="whitespace-pre-line" />
        {!area && <p className="text-sm text-muted-foreground">Draw an area on the map first</p>}
        {me.data === null ? (
          <Link to="/" search={{ auth: "login" }} className={buttonVariants()}>
            Log in to run
          </Link>
        ) : (
          <Button type="submit" disabled={!area || me.isPending || create.isPending}>
            Run
          </Button>
        )}
      </FieldGroup>
    </form>
  );
}
