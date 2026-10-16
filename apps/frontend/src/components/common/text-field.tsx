import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type TextFieldProps<TValues extends FieldValues, TOutput> = {
  control: Control<TValues, unknown, TOutput>;
  name: FieldPath<TValues>;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
};

/** A labelled input bound to a react-hook-form field, with the field's error under it. */
export function TextField<TValues extends FieldValues, TOutput>({
  control,
  name,
  label,
  type = "text",
  autoComplete,
}: TextFieldProps<TValues, TOutput>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input {...field} id={name} type={type} autoComplete={autoComplete} aria-invalid={fieldState.invalid} />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
