import { z } from "zod";

export const idParamsSchema = z.object({
  id: z.uuid(),
});
export type IdParams = z.infer<typeof idParamsSchema>;
