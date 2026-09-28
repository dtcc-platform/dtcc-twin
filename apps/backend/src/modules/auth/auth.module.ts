import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { UsersModule } from "../users/users.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { SessionsRepository } from "./sessions.repository.js";
import { AccessTokens } from "./tokens/access-tokens.js";
import { AuthCookies } from "./tokens/auth-cookies.js";

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, SessionsRepository, AccessTokens, AuthCookies, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
