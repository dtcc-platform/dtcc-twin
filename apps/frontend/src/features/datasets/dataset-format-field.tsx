import { Field, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { artifactFormatLabel } from "@/lib/artifact-formats";
import type { FormatChoice } from "./dataset-formats.ts";

type DatasetFormatFieldProps = {
  choices: FormatChoice[];
  /** The format the job sends, or null when none is available. */
  value: string | null;
  onChange: (format: string) => void;
};

/** The format of the extra file the job adds to its package, from the formats its product offers. */
export function DatasetFormatField({ choices, value, onChange }: DatasetFormatFieldProps) {
  if (choices.length === 0) {
    return (
      <Field>
        <FieldTitle>Format</FieldTitle>
        <FieldDescription className="text-xs">Package only: this result has no other format</FieldDescription>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor="dataset-artifact-format">Format</FieldLabel>
      <NativeSelect
        id="dataset-artifact-format"
        value={value ?? ""}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full"
      >
        {value === null && <NativeSelectOption value="">None available with these settings</NativeSelectOption>}
        {choices.map(({ format, unavailable }) => (
          <NativeSelectOption key={format} value={format} disabled={unavailable !== null}>
            {artifactFormatLabel(format) + (unavailable ? ` (${unavailable})` : "")}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldDescription className="text-xs">A file of the result, next to the package</FieldDescription>
    </Field>
  );
}
