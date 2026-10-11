import { z } from "zod";
import { offsetPage, offsetPaginationQuerySchema } from "../common/pagination.js";

export const roleSchema = z.enum(["user", "admin"]);
export type Role = z.infer<typeof roleSchema>;

// Whether an admin has let the user in. Only active users can get gateway keys.
export const userStatusSchema = z.enum(["pending", "active", "disabled"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

// The gateway's limits for the user's keys. Each tier is an APISIX consumer group of the same name.
export const tierSchema = z.enum(["default", "elevated"]);
export type Tier = z.infer<typeof tierSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: roleSchema,
  status: userStatusSchema,
  tier: tierSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;

export const userPageSchema = offsetPage(userSchema);
export type UserPage = z.infer<typeof userPageSchema>;

export const userListQuerySchema = offsetPaginationQuerySchema.extend({
  status: userStatusSchema.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

// No trim or lowercase: a transform before the check hides `format: email` from OpenAPI.
// The database enforces case-insensitive uniqueness instead.
export const emailSchema = z.email().max(254);
export const userNameSchema = z.string().trim().min(1).max(100);
// Length only, no composition rules (NIST SP 800-63B).
export const passwordSchema = z.string().min(8).max(128);

// An admin creating a user; self sign-up is registerBodySchema.
export const createUserBodySchema = z.strictObject({
  email: emailSchema,
  name: userNameSchema,
  password: passwordSchema,
  // Omitted: the database default, "user".
  role: roleSchema.optional(),
});
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

export const updateUserBodySchema = z.strictObject({
  email: emailSchema.optional(),
  name: userNameSchema.optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

// Approve, reject, disable and enable. Nothing goes back to pending.
export const setUserStatusBodySchema = z.strictObject({
  status: userStatusSchema.exclude(["pending"]),
});
export type SetUserStatusBody = z.infer<typeof setUserStatusBodySchema>;

export const setUserTierBodySchema = z.strictObject({
  tier: tierSchema,
});
export type SetUserTierBody = z.infer<typeof setUserTierBodySchema>;
