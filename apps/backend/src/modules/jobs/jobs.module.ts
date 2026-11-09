import { Module } from "@nestjs/common";
import { EngineModule } from "../../infra/engine/engine.module.js";
import { StorageModule } from "../../infra/storage/storage.module.js";
import { ValkeyModule } from "../../infra/valkey/valkey.module.js";
import { UsersModule } from "../users/users.module.js";
import { JobLimit } from "./job-limit.js";
import { JobsController } from "./jobs.controller.js";
import { JobsRepository } from "./jobs.repository.js";
import { JobsService } from "./jobs.service.js";

@Module({
  imports: [EngineModule, StorageModule, UsersModule, ValkeyModule],
  controllers: [JobsController],
  providers: [JobsService, JobsRepository, JobLimit],
  exports: [JobsService],
})
export class JobsModule {}
