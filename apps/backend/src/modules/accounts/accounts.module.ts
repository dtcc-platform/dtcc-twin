import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UsersModule } from "../users/users.module.js";
import { AccountsAdminController, AccountsController } from "./accounts.controller.js";
import { AccountsService } from "./accounts.service.js";

// Above users and the modules that read users, so it can change a user and reach everything that depends on them.
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AccountsController, AccountsAdminController],
  providers: [AccountsService],
})
export class AccountsModule {}
