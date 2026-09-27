import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Role } from "@repo/contracts";
import type { Request } from "express";

// Every route is admin-only unless it declares one of these; AuthGuard enforces them.

export const IS_PUBLIC_KEY = "isPublic";
export const ROLES_KEY = "roles";

/** Anyone may call the route, logged in or not. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Opens an admin-only route to these roles; admins still pass. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export type AuthUser = {
  userId: string;
  /** One login on one device. */
  sessionId: string;
  role: Role;
};

/** `user` is set on every request except to a @Public() route. */
export type AuthenticatedRequest = Request & { user?: AuthUser };

/** `@CurrentUser() user: AuthUser` */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!user) throw new Error("@CurrentUser() used on a route without a logged-in user");
  return user;
});
