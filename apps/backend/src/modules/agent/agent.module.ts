import { AgentWatcher } from "./agent.watcher.js";
import { Module } from "@nestjs/common";
import { ModelModule } from "../../infra/model/model.module.js";
import { DatasetsModule } from "../datasets/datasets.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { UsersModule } from "../users/users.module.js";
import { AgentRepository } from "./agent.repository.js";
import { AgentTools } from "./agent.tools.js";
import { AgentTurnRunner } from "./agent.turns.js";
import { AgentService } from "./agent.service.js";
import { AgentController } from "./agent.controller.js";
@Module({
  imports: [ModelModule, DatasetsModule, JobsModule, UsersModule],
  controllers: [AgentController],
  providers: [AgentWatcher, AgentRepository, AgentTools, AgentTurnRunner, AgentService],
  exports: [AgentService],
})
export class AgentModule {}
