import { Module } from "@nestjs/common";
import { UsersRepository } from "./users.repository.js";
import { UsersService } from "./users.service.js";

// The user record, which other modules read. No routes: those are in AccountsModule.
@Module({
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
