import { z } from "zod";
import { offsetPage } from "../common/pagination.js";

export const itemSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Item = z.infer<typeof itemSchema>;

export const itemPageSchema = offsetPage(itemSchema);
export type ItemPage = z.infer<typeof itemPageSchema>;

const itemNameSchema = z.string().trim().min(1).max(100);
const descriptionSchema = z.string().trim().max(500).nullable();

// No owner: an item belongs to the user who creates it, for life.
export const createItemBodySchema = z.strictObject({
  name: itemNameSchema,
  description: descriptionSchema.optional(),
});
export type CreateItemBody = z.infer<typeof createItemBodySchema>;

export const updateItemBodySchema = z.strictObject({
  name: itemNameSchema.optional(),
  description: descriptionSchema.optional(),
});
export type UpdateItemBody = z.infer<typeof updateItemBodySchema>;
