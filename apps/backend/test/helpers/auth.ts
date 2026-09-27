import type { Role } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import type { AuthUser } from "../../src/common/decorators/auth.decorators.js";
import { signAccessToken } from "../../src/modules/auth/tokens/access-tokens.js";

/**
 * A token for a made-up user: the guard never looks users up, so no row is needed and it survives
 * `truncateAllTables()`. `request(…).get(…).set(await authHeader("admin"))`
 */
export async function authHeader(role: Role, user: Partial<AuthUser> = {}): Promise<{ Authorization: string }> {
  const token = await accessToken({ userId: randomUUID(), sessionId: randomUUID(), role, ...user });
  return { Authorization: `Bearer ${token}` };
}

export function accessToken(user: AuthUser): Promise<string> {
  const key = new TextEncoder().encode(process.env["JWT_SECRET"]);
  return signAccessToken(user, key);
}
