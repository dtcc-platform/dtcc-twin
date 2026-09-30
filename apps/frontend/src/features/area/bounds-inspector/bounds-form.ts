import { z } from "zod";
import { areaSizeProblem, areaSizeProblemText, areaSquareMetres, type Area } from "@/features/area/area";

const decimalDegrees = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, "Enter a number")
  .transform(Number);
const longitude = decimalDegrees.pipe(
  z.number().min(-180, "Longitude runs from -180 to 180").max(180, "Longitude runs from -180 to 180"),
);
const latitude = decimalDegrees.pipe(
  z.number().min(-90, "Latitude runs from -90 to 90").max(90, "Latitude runs from -90 to 90"),
);

/** The bounds inspector's fields, read as an area; a size outside the limits is the form's error, under `root`. */
export const boundsSchema = z
  .object({ west: longitude, south: latitude, east: longitude, north: latitude })
  .check((context) => {
    // trap: Zod runs this even when a field failed, with that field's raw text in its place.
    if (context.issues.length > 0) return;
    const area = context.value;
    if (area.north <= area.south) {
      context.issues.push({ code: "custom", input: area, path: ["north"], message: "Must be north of south" });
    }
    if (area.east <= area.west) {
      context.issues.push({ code: "custom", input: area, path: ["east"], message: "Must be east of west" });
    }
    if (context.issues.length > 0) return;

    const problem = areaSizeProblem(areaSquareMetres(area));
    if (problem) {
      context.issues.push({ code: "custom", input: area, path: ["root"], message: areaSizeProblemText[problem] });
    }
  });

export type BoundsFields = z.input<typeof boundsSchema>;

export function toBoundsFields(area: Area | null): BoundsFields {
  if (!area) return { west: "", south: "", east: "", north: "" };
  return {
    west: formatDegrees(area.west),
    south: formatDegrees(area.south),
    east: formatDegrees(area.east),
    north: formatDegrees(area.north),
  };
}

// Six decimals is about 10 cm, without the trailing zeros.
function formatDegrees(degrees: number): string {
  return String(Number(degrees.toFixed(6)));
}
