import { Module } from "@nestjs/common";
import { ValkeyModule } from "../../infra/valkey/valkey.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  imports: [ValkeyModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
