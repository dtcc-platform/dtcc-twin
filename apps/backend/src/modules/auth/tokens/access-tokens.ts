import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { roleSchema } from "@repo/contracts";
import { errors, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { z } from "zod";
import type { AuthUser } from "../../../common/decorators/auth.decorators.js";
import type { Env } from "../../../config/env.schema.js";
import { accessTokenLifetimeSeconds } from "./lifetimes.js";

const algorithm = "HS256";

const claimsSchema = z.object({ sub: z.uuid(), sid: z.uuid(), role: roleSchema });

// The functions below stay exported for code outside the Nest container: the unit spec and test/helpers/auth.ts.
@Injectable()
export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(config: ConfigService<Env, true>) {
    this.key = new TextEncoder().encode(config.get("JWT_SECRET", { infer: true }));
  }

  sign(user: AuthUser): Promise<string> {
    return signAccessToken(user, this.key);
  }

  /** Stateless, no database: a revoked session's token keeps working until it expires. */
  verify(token: string): Promise<AuthUser | undefined> {
    return verifyAccessToken(token, this.key);
  }
}

export function signAccessToken(user: AuthUser, key: Uint8Array): Promise<string> {
  return new SignJWT({ sid: user.sessionId, role: user.role })
    .setProtectedHeader({ alg: algorithm })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${String(accessTokenLifetimeSeconds)}s`)
    .sign(key);
}

/** Undefined for an expired, forged or malformed token. */
export async function verifyAccessToken(token: string, key: Uint8Array): Promise<AuthUser | undefined> {
  const payload = await verifiedPayload(token, key);
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) return undefined;

  return { userId: claims.data.sub, sessionId: claims.data.sid, role: claims.data.role };
}

async function verifiedPayload(token: string, key: Uint8Array): Promise<JWTPayload | undefined> {
  try {
    // Pinning the algorithm is what rejects `alg: none` and any other algorithm a token claims.
    const { payload } = await jwtVerify(token, key, { algorithms: [algorithm] });
    return payload;
  } catch (error) {
    // Only jose's own verdicts mean "invalid token"; anything else is a bug and should surface.
    if (error instanceof errors.JOSEError) return undefined;
    throw error;
  }
}
