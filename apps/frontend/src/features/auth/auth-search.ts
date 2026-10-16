import { z } from "zod";

export const authModeSchema = z.enum(["login", "register"]);
export type AuthMode = z.infer<typeof authModeSchema>;

/** `/?auth=login` opens the login dialog over the map; `redirect` is where to go once logged in. */
export const authSearchSchema = z.object({
  auth: authModeSchema.optional(),
  redirect: z.string().optional(),
});
