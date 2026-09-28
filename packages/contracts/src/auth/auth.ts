import { z } from "zod";
import { emailSchema, userNameSchema, passwordSchema } from "../users/users.js";

export const registerBodySchema = z.strictObject({
  email: emailSchema,
  name: userNameSchema,
  password: passwordSchema,
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.strictObject({
  email: emailSchema,
  // Not passwordSchema: a password set under older, looser rules must still log in.
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const sessionSchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  // The session making this request.
  current: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionListSchema = z.object({ items: z.array(sessionSchema) });
export type SessionList = z.infer<typeof sessionListSchema>;
