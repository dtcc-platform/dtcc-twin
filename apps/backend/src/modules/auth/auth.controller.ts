import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import {
  idParamsSchema,
  loginBodySchema,
  registerBodySchema,
  sessionListSchema,
  userSchema,
  type IdParams,
  type LoginBody,
  type RegisterBody,
  type SessionList,
  type User,
} from "@repo/contracts";
import type { Request, Response } from "express";
import { CurrentUser, Public, Roles, type AuthUser } from "../../common/decorators/auth.decorators.js";
import { Serialize } from "../../common/decorators/serialize.decorator.js";
import { AuthService } from "./auth.service.js";
import { AuthCookies } from "./tokens/auth-cookies.js";

// Tokens travel only in HttpOnly cookies. `passthrough` lets a handler set them and still return a serialized body.
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Post("register")
  @Public()
  @Serialize(userSchema)
  async register(
    @Body({ schema: registerBodySchema }) body: RegisterBody,
    @Headers("user-agent") userAgent: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    const { user, tokens } = await this.auth.register(body, userAgent);
    this.cookies.set(response, tokens);
    return user;
  }

  @Post("login")
  @Public()
  @HttpCode(HttpStatus.OK)
  @Serialize(userSchema)
  async login(
    @Body({ schema: loginBodySchema }) body: LoginBody,
    @Headers("user-agent") userAgent: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    const { user, tokens } = await this.auth.login(body, userAgent);
    this.cookies.set(response, tokens);
    return user;
  }

  // The frontend asks this on load: 200 means logged in, 401 means not.
  @Get("me")
  @Roles("user")
  @Serialize(userSchema)
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user);
  }

  // Public: the access token has usually expired by the time a client refreshes.
  @Post("refresh")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const refreshToken = this.cookies.readRefreshToken(request);
    const tokens = await this.auth.refresh(refreshToken);
    if (!tokens) {
      this.cookies.clear(response);
      throw new UnauthorizedException("Session expired");
    }

    this.cookies.set(response, tokens);
  }

  // Public: logging out must work after the access token expired.
  @Post("logout")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const refreshToken = this.cookies.readRefreshToken(request);
    await this.auth.logout(refreshToken);
    this.cookies.clear(response);
  }

  @Post("logout-all")
  @Roles("user")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logoutAll(user.userId);
    this.cookies.clear(response);
  }

  @Get("sessions")
  @Roles("user")
  @Serialize(sessionListSchema)
  async sessions(@CurrentUser() user: AuthUser): Promise<SessionList> {
    const items = await this.auth.listSessions(user);
    return { items };
  }

  @Delete("sessions/:id")
  @Roles("user")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(@CurrentUser() user: AuthUser, @Param({ schema: idParamsSchema }) { id }: IdParams): Promise<void> {
    return this.auth.revokeSession(user.userId, id);
  }
}
