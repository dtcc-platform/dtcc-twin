import { z } from "zod";

// Coerced because query values arrive as strings; `z.input` is therefore unknown, so type callers with the output.
export const offsetPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type OffsetPaginationQuery = z.infer<typeof offsetPaginationQuerySchema>;

export function offsetPage<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    limit: z.int().positive(),
    offset: z.int().nonnegative(),
    total: z.int().nonnegative(),
  });
}
