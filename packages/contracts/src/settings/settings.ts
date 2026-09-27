import { z } from "zod";

// Placeholder fields: they exist to show a one-to-one relation (one settings record per user).
export const themeSchema = z.enum(["system", "light", "dark"]);
export type Theme = z.infer<typeof themeSchema>;

// No timestamps: until the first change, GET answers the defaults, which have none.
export const settingsSchema = z.object({
  userId: z.uuid(),
  theme: themeSchema,
  notificationsEnabled: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsBodySchema = z.strictObject({
  theme: themeSchema.optional(),
  notificationsEnabled: z.boolean().optional(),
});
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;
