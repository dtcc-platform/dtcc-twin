import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module.js";
import { DatasetsController } from "./datasets.controller.js";
import { DatasetsService } from "./datasets.service.js";

@Module({
  imports: [EngineModule],
  controllers: [DatasetsController],
  providers: [DatasetsService],
})
export class DatasetsModule {}
