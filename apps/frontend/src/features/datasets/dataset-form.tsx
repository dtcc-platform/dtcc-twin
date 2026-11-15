import { zodResolver } from "@hookform/resolvers/zod";
import type { CreateJobBody, Dataset } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { authQueries } from "@/api/auth";
import { ApiError } from "@/api/client/api-error";
import { jobMutations } from "@/api/jobs";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { areaBounds } from "@/features/area/area";
import { useAreaStore } from "@/features/area/area-store";
import { usePendingDownloadsStore } from "@/features/jobs/pending-downloads-store";
import { useLayersStore } from "@/features/layers/layers-store";
import { useWorkspaceStore } from "@/features/workspace/workspace-store";
import { drawsOnMap } from "@/lib/artifact-formats";
import { DatasetFieldControl } from "./dataset-field-control.tsx";
import { datasetFields } from "./dataset-fields.ts";
import { DatasetFormatField } from "./dataset-format-field.tsx";
import { formatChoices, jobFormat } from "./dataset-formats.ts";
import {
  changedParameters,
  initialValues,
  jobParameters,
  valuesSchema,
  type DatasetFormValues,
} from "./dataset-values.ts";
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
  const watched = useWatch({ control: form.control });
  const [chosenFormat, setChosenFormat] = useState<string | null>(null);
  const choices = formatChoices(dataset, changedParameters(fields, watched));
  const format = jobFormat(choices, chosenFormat);

  const create = useMutation(jobMutations.create());
  const { setRight, setLeft } = useWorkspaceStore((state) => state.actions);
  const { add: addLayer } = useLayersStore((state) => state.actions);
  const { add: addDownload } = usePendingDownloadsStore((state) => state.actions);
  const runnable = area !== null && me.data?.status === "active" && !create.isPending;

  function submit(values: DatasetFormValues, action: "add-to-area" | "download") {
    if (!area) return;
    const body: CreateJobBody = { dataset: dataset.name, parameters: jobParameters(fields, values, areaBounds(area)) };
    if (format !== null) body.artifactFormat = format;
    // The promise, not mutate's callbacks: those don't run once the form has closed, and the job must still reach the
    // map or the downloads.
    create.mutateAsync(body).then(
      (job) => {
        if (action === "download") {
          addDownload({ jobId: job.id, title: dataset.title });
          toast.success("Job submitted", {
            description: `${dataset.title} downloads when it's done`,
            action: { label: "View in Downloads", onClick: () => setRight("downloads") },
          });
          return;
        }
        addLayer({ jobId: job.id, title: dataset.title });
        toast.success("Job submitted", {
          description: `${dataset.title} shows on the map when it's done`,
          action: { label: "View layers", onClick: () => setLeft("layers") },
        });
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.body?.code === "TOO_MANY_REQUESTS") {
          toast.error("Hourly job limit reached", { description: error.message });
          return;
        }
        const errors = submitErrors(fields, error);
        for (const [name, message] of Object.entries(errors.fields)) form.setError(name, { message });
        if (errors.form.length > 0) form.setError("root", { message: errors.form.join("\n") });
      },
    );
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit((values) => submit(values, "add-to-area"))(event)} noValidate>
      <FieldGroup className="gap-5">
        {fields.map((field) => (
          <DatasetFieldControl key={field.name} control={form.control} field={field} />
        ))}
        {omitted.length > 0 && <p className="text-xs text-muted-foreground">Uses the default: {omitted.join(", ")}</p>}
        <DatasetFormatField choices={choices} value={format} onChange={setChosenFormat} />
        <FieldError errors={[form.formState.errors.root]} className="whitespace-pre-line" />
        {!area && <p className="text-sm text-muted-foreground">Draw an area on the map first</p>}
        {me.data?.status === "pending" && (
          <p className="text-sm text-muted-foreground">You can run Datasets once an admin approves your account</p>
        )}
        {me.data?.status === "disabled" && (
          <p className="text-sm text-muted-foreground">Your account has been disabled</p>
        )}
        {me.data === null ? (
          <Link to="/" search={{ auth: "login" }} className={buttonVariants()}>
            Log in to run
          </Link>
        ) : (
          <>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={!runnable || !drawsOnMap(format)}>
                Add to area
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={!runnable}
                onClick={() => void form.handleSubmit((values) => submit(values, "download"))()}
              >
                Download
              </Button>
            </div>
            {runnable && !drawsOnMap(format) && (
              <p className="text-xs text-muted-foreground">Not shown on the map: download only</p>
            )}
          </>
        )}
      </FieldGroup>
    </form>
  );
}
