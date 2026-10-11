import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UsersModule } from "../users/users.module.js";
import { AccountsController } from "./accounts.controller.js";
import { AccountsService } from "./accounts.service.js";

// Its own module because AuthModule already imports UsersModule: UsersModule can't reach sessions without a cycle.
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
