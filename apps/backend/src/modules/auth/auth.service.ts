import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { LoginBody, RegisterBody, Session, User } from "@repo/contracts";
import { createHash, randomBytes } from "node:crypto";
import type { AuthUser } from "../../common/decorators/auth.decorators.js";
import { UsersService } from "../users/users.service.js";
import { SessionsRepository } from "./sessions.repository.js";
import { AccessTokens } from "./tokens/access-tokens.js";

export type Tokens = {
  accessToken: string;
  refreshToken: string;
};

export type LoggedIn = {
  user: User;
  tokens: Tokens;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly accessTokens: AccessTokens,
    private readonly sessions: SessionsRepository,
    private readonly users: UsersService,
  ) {}

  async register(body: RegisterBody, userAgent?: string): Promise<LoggedIn> {
    const user = await this.users.create(body);
    const tokens = await this.issue(user, userAgent);
    return { user, tokens };
  }

  async login({ email, password }: LoginBody, userAgent?: string): Promise<LoggedIn> {
    const user = await this.users.verifyCredentials(email, password);
    // One message for both mistakes, so the answer does not reveal which emails have an account.
    if (!user) throw new UnauthorizedException("Invalid email or password");

    const tokens = await this.issue(user, userAgent);
    return { user, tokens };
  }

  async issue(user: Pick<User, "id" | "role">, userAgent?: string): Promise<Tokens> {
    // Nothing clears expired sessions on a schedule yet, so a user's are cleared when they log in again.
    await this.sessions.deleteExpired(user.id);

    const refreshToken = createRefreshToken();
    const sessionId = await this.sessions.insert(user.id, hashRefreshToken(refreshToken), userAgent);
    const accessToken = await this.accessTokens.sign({ userId: user.id, sessionId, role: user.role });
    return { accessToken, refreshToken };
  }

  /**
   * Slides the session's expiry and signs a new access token. The refresh token is not rotated, so
   * refreshes from several tabs can't race. Undefined, not a 401: the controller clears the cookies first.
   */
  async refresh(refreshToken: string | undefined): Promise<Tokens | undefined> {
    if (!refreshToken) return undefined;

    const session = await this.sessions.extend(hashRefreshToken(refreshToken));
    if (!session) return undefined;

    // Read fresh rather than carried over, so a role change reaches the user at their next refresh.
    const user = await this.users.get(session.userId);
    const accessToken = await this.accessTokens.sign({ userId: user.id, sessionId: session.id, role: user.role });
    return { accessToken, refreshToken };
  }

  /** The logged-in user as stored now, not as the access token remembers them. */
  me(user: AuthUser): Promise<User> {
    return this.users.get(user.userId);
  }

  /** Ends the session a refresh token belongs to, if any: logging out twice is not an error. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.sessions.deleteByRefreshTokenHash(hashRefreshToken(refreshToken));
  }

  logoutAll(userId: string): Promise<void> {
    return this.sessions.deleteAll(userId);
  }

  async listSessions(user: AuthUser): Promise<Session[]> {
    const rows = await this.sessions.findAll(user.userId);
    return rows.map((row) => ({ ...row, current: row.id === user.sessionId }));
  }

  /** Another user's session answers as missing. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const deleted = await this.sessions.delete(userId, sessionId);
    if (!deleted) throw new NotFoundException(`Session ${sessionId} not found`);
  }
}

function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

// SHA-256, not argon2: 256 random bits can't be guessed, and a fast hash lets the row be looked up by it.
function hashRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}
