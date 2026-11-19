import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { every } from "../../common/background/every.js";
import { AgentService } from "./agent.service.js";

@Injectable()
export class AgentWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private loop: ReturnType<typeof every> | undefined;
  constructor(
    private readonly agent: AgentService,
    private readonly config: ConfigService<Env, true>,
  ) {}
  onApplicationBootstrap(): void {
    const seconds = this.config.get("AGENT_RESUME_INTERVAL_SECONDS", { infer: true });
    if (seconds > 0)
      this.loop = every(seconds * 1000, () => this.agent.resumeFinished(), new Logger(AgentWatcher.name));
  }
  async onModuleDestroy(): Promise<void> {
    await this.loop?.stop();
  }
}
