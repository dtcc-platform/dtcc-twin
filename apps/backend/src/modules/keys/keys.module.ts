import { Module } from "@nestjs/common";
import { GatewayModule } from "../../infra/gateway/gateway.module.js";
import { UsersModule } from "../users/users.module.js";
import { KeysAdminController, KeysController } from "./keys.controller.js";
import { KeysRepository } from "./keys.repository.js";
import { KeysService } from "./keys.service.js";

@Module({
  imports: [UsersModule, GatewayModule],
  controllers: [KeysController, KeysAdminController],
  providers: [KeysService, KeysRepository],
  exports: [KeysService],
})
export class KeysModule {}
