import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type TextFieldProps<TValues extends FieldValues, TOutput> = {
  control: Control<TValues, unknown, TOutput>;
  name: FieldPath<TValues>;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  /** The input's id, for a page with two forms that share a field name; the name by default. */
  id?: string;
  autoFocus?: boolean;
};

/** A labelled input bound to a react-hook-form field, with the field's error under it. */
export function TextField<TValues extends FieldValues, TOutput>({
  control,
  name,
  label,
  type = "text",
  autoComplete,
  id = name,
  autoFocus,
}: TextFieldProps<TValues, TOutput>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...field}
            id={id}
            type={type}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            aria-invalid={fieldState.invalid}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
