import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CookieOptions, Request, Response } from "express";
import type { Env } from "../../../config/env.schema.js";
import type { Tokens } from "../auth.service.js";
import { accessTokenLifetimeSeconds, sessionLifetimeSeconds } from "./lifetimes.js";

type Cookie = {
  name: string;
  options: CookieOptions;
};

/**
 * Production uses the `__Host-`/`__Secure-` prefixes, which browsers accept only on Secure cookies.
 * Elsewhere both go, because Safari refuses Secure cookies from http://localhost.
 */
@Injectable()
export class AuthCookies {
  private readonly access: Cookie;
  private readonly refresh: Cookie;

  constructor(config: ConfigService<Env, true>) {
    const production = config.get("NODE_ENV", { infer: true }) === "production";
    const options: CookieOptions = { httpOnly: true, sameSite: "lax", secure: production };

    this.access = {
      name: production ? "__Host-access_token" : "access_token",
      options: { ...options, path: "/" },
    };
    // Scoped to the auth routes, the only ones that read it, so no other request ever carries it.
    this.refresh = {
      name: production ? "__Secure-refresh_token" : "refresh_token",
      options: { ...options, path: "/api/auth" },
    };
  }

  set(response: Response, tokens: Tokens): void {
    response.cookie(this.access.name, tokens.accessToken, {
      ...this.access.options,
      maxAge: accessTokenLifetimeSeconds * 1000,
    });
    response.cookie(this.refresh.name, tokens.refreshToken, {
      ...this.refresh.options,
      maxAge: sessionLifetimeSeconds * 1000,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.access.name, this.access.options);
    response.clearCookie(this.refresh.name, this.refresh.options);
  }

  readAccessToken(request: Request): string | undefined {
    return readCookie(request, this.access.name);
  }

  readRefreshToken(request: Request): string | undefined {
    return readCookie(request, this.refresh.name);
  }
}

function readCookie(request: Request, name: string): string | undefined {
  // cookie-parser types every value as any.
  const value: unknown = request.cookies[name];
  return typeof value === "string" ? value : undefined;
}
