import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UsersModule } from "../users/users.module.js";
import { AccountsAdminController, AccountsController } from "./accounts.controller.js";
import { AccountsService } from "./accounts.service.js";

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AccountsController, AccountsAdminController],
  providers: [AccountsService],
})
export class AccountsModule {}
