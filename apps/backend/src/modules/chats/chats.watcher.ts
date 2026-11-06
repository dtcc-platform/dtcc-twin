import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { every, type Repeating } from "../../common/background/every.js";
import type { Env } from "../../config/env.schema.js";
import { ChatsService } from "./chats.service.js";

/** Every CHAT_RESUME_INTERVAL_SECONDS, tells the chats waiting on jobs how the jobs ended, in a turn of their own. */
@Injectable()
export class ChatsWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ChatsWatcher.name);
  private readonly intervalMs: number;
  private repeating: Repeating | undefined;

  constructor(
    private readonly chats: ChatsService,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get("CHAT_RESUME_INTERVAL_SECONDS", { infer: true }) * 1000;
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs > 0) this.repeating = every(this.intervalMs, () => this.chats.resumeFinished(), this.logger);
  }

  // Before shutdown, when the database pool closes: a run in progress still needs it.
  async onModuleDestroy(): Promise<void> {
    await this.repeating?.stop();
  }
}
