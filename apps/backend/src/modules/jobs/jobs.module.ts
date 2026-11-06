import { Module } from "@nestjs/common";
import { EngineModule } from "../../infra/engine/engine.module.js";
import { StorageModule } from "../../infra/storage/storage.module.js";
import { UsersModule } from "../users/users.module.js";
import { JobsController } from "./jobs.controller.js";
import { JobsRepository } from "./jobs.repository.js";
import { JobsService } from "./jobs.service.js";
import { JobsWatcher } from "./jobs.watcher.js";

@Module({
  imports: [EngineModule, StorageModule, UsersModule],
  controllers: [JobsController],
  providers: [JobsService, JobsRepository, JobsWatcher],
  exports: [JobsService],
})
export class JobsModule {}
