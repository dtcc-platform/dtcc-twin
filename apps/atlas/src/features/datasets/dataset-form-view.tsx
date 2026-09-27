import { zodResolver } from "@hookform/resolvers/zod";
import type { Dataset } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeftIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { toast } from "sonner";
import { jobMutations } from "@/api/jobs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { areaFormSchema, swerefBounds } from "@/features/area/area";
import { useSelectedArea } from "@/features/area/area-store";
import { showSubmitError } from "@/features/auth/show-submit-error";
import {
  datasetFormFields,
  datasetFormSchema,
  defaultFormValues,
  jobParameters,
  type FormField,
  type FormValues,
} from "./dataset-form";

type DatasetFormViewProps = { dataset: Dataset; onBack: () => void; onQueued: () => void };

/** The selected Dataset's parameters, generated from its JSON Schema, and the button that runs it on the area. */
export function DatasetFormView({ dataset, onBack, onQueued }: DatasetFormViewProps) {
  // The schema never changes for a Dataset, and the parent remounts this view for another one.
  const [{ fields, omitted }] = useState(() => datasetFormFields(dataset.argsSchema));
  const [schema] = useState(() => datasetFormSchema(fields));
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaultFormValues(fields) });
  const createJob = useMutation(jobMutations.create());
  const area = useSelectedArea()?.area ?? null;
  const areaReady = area !== null && areaFormSchema.safeParse(area).success;

  function run(values: FormValues) {
    if (!area) return;
    const body = { dataset: dataset.name, parameters: jobParameters(fields, values, swerefBounds(area)) };
    createJob.mutate(body, {
      onSuccess: () => {
        toast.success(`${dataset.title} queued`);
        onQueued();
      },
      onError: (error) => {
        showSubmitError(form.setError, error);
      },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack}>
        <ArrowLeftIcon />
        All Datasets
      </Button>
      <div>
        <h3 className="font-medium">{dataset.title}</h3>
        <p className="text-muted-foreground">{dataset.description}</p>
      </div>
      <form onSubmit={(event) => void form.handleSubmit(run)(event)} noValidate className="flex flex-col gap-4">
        {fields.map((field) => (
          <ParameterField key={field.name} control={form.control} field={field} />
        ))}
        {omitted.length > 0 && (
          <p className="text-xs text-muted-foreground">Also uses the default for: {omitted.join(", ")}.</p>
        )}
        <FieldError errors={[form.formState.errors.root]} />
        <Button type="submit" disabled={!areaReady || createJob.isPending} className="w-fit">
          <PlayIcon />
          Run on this area
        </Button>
        {!areaReady && (
          <p className="text-xs text-muted-foreground">
            {area ? "Resize the area to within the limits first." : "Select an area first."}
          </p>
        )}
      </form>
    </div>
  );
}

function ParameterField({ control, field }: { control: Control<FormValues>; field: FormField }) {
  const id = `parameter-${field.name}`;

  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: input, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          {field.kind === "boolean" && (
            <Switch id={id} checked={input.value === true} onCheckedChange={input.onChange} onBlur={input.onBlur} />
          )}
          {field.kind === "choice" && (
            <NativeSelect
              id={id}
              value={String(input.value)}
              onChange={(event) => {
                input.onChange(toChoice(field.options, event.target.value));
              }}
              onBlur={input.onBlur}
            >
              {field.optional && <NativeSelectOption value="">Default</NativeSelectOption>}
              {field.options.map((option) => (
                <NativeSelectOption key={String(option)} value={String(option)}>
                  {option}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {field.kind === "choices" && (
            <ChoiceList id={id} options={field.options} value={input.value} onChange={input.onChange} />
          )}
          {(field.kind === "number" || field.kind === "integer") && (
            <Input
              id={id}
              type="number"
              step={field.kind === "integer" ? 1 : "any"}
              placeholder={field.optional ? "Default" : undefined}
              value={typeof input.value === "number" && !Number.isNaN(input.value) ? input.value : ""}
              onChange={(event) => {
                input.onChange(event.target.valueAsNumber);
              }}
              onBlur={input.onBlur}
              aria-invalid={fieldState.invalid}
            />
          )}
          {field.kind === "text" && (
            <Input
              id={id}
              placeholder={field.optional ? "Default" : undefined}
              value={typeof input.value === "string" ? input.value : ""}
              onChange={input.onChange}
              onBlur={input.onBlur}
              aria-invalid={fieldState.invalid}
            />
          )}
          {field.description && <FieldDescription>{field.description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

type Choice = string | number;

type ChoiceListProps = { id: string; options: Choice[]; value: unknown; onChange: (value: Choice[]) => void };

function ChoiceList({ id, options, value, onChange }: ChoiceListProps) {
  const selected = Array.isArray(value) ? (value as Choice[]) : [];

  return (
    <div id={id} className="flex flex-col gap-1.5">
      {options.map((option) => (
        <label key={String(option)} className="flex items-center gap-2">
          <Checkbox
            checked={selected.includes(option)}
            onCheckedChange={(checked) => {
              onChange(checked ? [...selected, option] : selected.filter((entry) => entry !== option));
            }}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

// A select's value is always a string; hand the form the option itself, so integer choices stay numbers.
function toChoice(options: Choice[], value: string): Choice {
  return options.find((option) => String(option) === value) ?? "";
}
