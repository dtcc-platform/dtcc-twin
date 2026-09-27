import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@repo/contracts";
import { IS_PUBLIC_KEY, ROLES_KEY, type AuthenticatedRequest } from "../../common/decorators/auth.decorators.js";
import { AccessTokens } from "./tokens/access-tokens.js";
import { AuthCookies } from "./tokens/auth-cookies.js";

// Guards every route. Admin-only unless @Roles() or @Public(), so a forgotten decorator locks rather than exposes.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokens,
    private readonly cookies: AuthCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.findToken(request);
    if (!token) throw new UnauthorizedException();

    const user = await this.accessTokens.verify(token);
    if (!user) throw new UnauthorizedException();
    request.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets) ?? [];
    const allowed = user.role === "admin" || roles.includes(user.role);
    if (!allowed) throw new ForbiddenException();
    return true;
  }

  // The header for non-browser clients, the cookie for browsers.
  private findToken(request: AuthenticatedRequest): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme?.toLowerCase() === "bearer" && token) return token;

    return this.cookies.readAccessToken(request);
  }
}
