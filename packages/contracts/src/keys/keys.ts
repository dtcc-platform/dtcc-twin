import { z } from "zod";
import { idParamsSchema } from "../common/params.js";

export const apiKeySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  // The key's first characters, enough to recognise it; the key itself is shown once, at creation.
  prefix: z.string(),
  createdAt: z.iso.datetime(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const apiKeyListSchema = z.object({ items: z.array(apiKeySchema) });
export type ApiKeyList = z.infer<typeof apiKeyListSchema>;

export const createdApiKeySchema = apiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const createApiKeyBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
});
export type CreateApiKeyBody = z.infer<typeof createApiKeyBodySchema>;

export const userKeyParamsSchema = idParamsSchema.extend({ keyId: z.uuid() });
export type UserKeyParams = z.infer<typeof userKeyParamsSchema>;
