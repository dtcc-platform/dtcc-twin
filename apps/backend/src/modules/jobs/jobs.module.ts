import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module.js";
import { JobsController } from "./jobs.controller.js";
import { JobsRepository } from "./jobs.repository.js";
import { JobsService } from "./jobs.service.js";
import { PackageStorage } from "./package-storage.js";

@Module({
  imports: [EngineModule],
  controllers: [JobsController],
  providers: [JobsService, JobsRepository, PackageStorage],
})
export class JobsModule {}
