import { z } from "zod";
import { offsetPage } from "../common/pagination.js";

const longitude = z.number().min(-180).max(180);
const latitude = z.number().min(-90).max(90);

/** A box in WGS84 degrees, as the map draws it; its EPSG:3006 bounds are derived where a Dataset needs them. */
export const areaBoxSchema = z
  .strictObject({ west: longitude, south: latitude, east: longitude, north: latitude })
  .check((context) => {
    // trap: Zod runs this even when a side failed, with its raw value in place.
    if (context.issues.length > 0) return;
    const { west, south, east, north } = context.value;
    if (east <= west) {
      context.issues.push({ code: "custom", input: east, path: ["east"], message: "Must be east of west" });
    }
    if (north <= south) {
      context.issues.push({ code: "custom", input: north, path: ["north"], message: "Must be north of south" });
    }
  });
export type AreaBox = z.infer<typeof areaBoxSchema>;

export const savedAreaSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  area: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SavedArea = z.infer<typeof savedAreaSchema>;

export const savedAreaPageSchema = offsetPage(savedAreaSchema);
export type SavedAreaPage = z.infer<typeof savedAreaPageSchema>;

// No owner: a saved area belongs to the user who saves it.
export const createSavedAreaBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  area: areaBoxSchema,
});
export type CreateSavedAreaBody = z.infer<typeof createSavedAreaBodySchema>;
