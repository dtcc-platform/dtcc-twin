import { Controller, type Control } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { DatasetField } from "./dataset-fields.ts";
import type { DatasetFormValues } from "./dataset-values.ts";

type DatasetFieldControlProps = { control: Control<DatasetFormValues>; field: DatasetField };

/** One field of a Dataset's form, with its description and its error under it. */
export function DatasetFieldControl({ control, field }: DatasetFieldControlProps) {
  const id = `dataset-${field.name}`;
  const description = field.description && <FieldDescription className="text-xs">{field.description}</FieldDescription>;

  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: input, fieldState }) => {
        const error = <FieldError errors={[fieldState.error]} />;
        const text = typeof input.value === "string" ? input.value : "";

        switch (field.control) {
          case "switch":
            return (
              <Field data-invalid={fieldState.invalid}>
                <div className="flex items-center gap-2">
                  <Switch
                    id={id}
                    checked={input.value === true}
                    onCheckedChange={input.onChange}
                    onBlur={input.onBlur}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                </div>
                {description}
                {error}
              </Field>
            );
          case "number":
          case "text":
            return (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                <Input
                  id={id}
                  ref={input.ref}
                  name={input.name}
                  value={text}
                  onChange={input.onChange}
                  onBlur={input.onBlur}
                  placeholder="Default"
                  inputMode={field.control === "number" ? (field.integer ? "numeric" : "decimal") : undefined}
                  aria-invalid={fieldState.invalid}
                />
                {description}
                {error}
              </Field>
            );
          case "select":
            return (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                <NativeSelect
                  id={id}
                  ref={input.ref}
                  name={input.name}
                  value={text}
                  onChange={input.onChange}
                  onBlur={input.onBlur}
                  className="w-full"
                  aria-invalid={fieldState.invalid}
                >
                  {/* Empty keeps the Dataset's default, which is what a field without one starts at. */}
                  {(field.optional || field.default === null) && (
                    <NativeSelectOption value="">Default</NativeSelectOption>
                  )}
                  {field.options.map((option) => (
                    <NativeSelectOption key={String(option)} value={String(option)}>
                      {String(option)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {description}
                {error}
              </Field>
            );
          case "checkboxes": {
            const chosen = Array.isArray(input.value) ? input.value : [];
            return (
              <FieldSet data-invalid={fieldState.invalid} className="gap-2">
                <FieldLegend variant="label">{field.label}</FieldLegend>
                {field.options.map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-${option}`}
                      checked={chosen.includes(option)}
                      onCheckedChange={(checked) => {
                        input.onChange(checked ? [...chosen, option] : chosen.filter((value) => value !== option));
                      }}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldLabel htmlFor={`${id}-${option}`} className="font-normal">
                      {option}
                    </FieldLabel>
                  </div>
                ))}
                {description}
                {error}
              </FieldSet>
            );
          }
        }
      }}
    />
  );
}
