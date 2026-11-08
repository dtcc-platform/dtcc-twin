import { Inject, Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Valkey } from "iovalkey";
import type { EnvConfigService } from "../../config/env.schema.js";

export const VALKEY = Symbol("VALKEY");

/** Inject with `@InjectValkey() valkey: Valkey`. */
export const InjectValkey = (): ParameterDecorator => Inject(VALKEY);

const logger = new Logger("Valkey");

@Module({
  providers: [
    {
      provide: VALKEY,
      inject: [ConfigService],
      useFactory: (config: EnvConfigService) => {
        // Connects in the background and reconnects on its own, so the app boots without Valkey.
        const valkey = new Valkey(config.get("VALKEY_URL", { infer: true }), {
          // A command fails at once while Valkey is unreachable, and one in flight when the connection
          // drops fails too, rather than wait for a reconnect and be resent.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
        });
        // Emitted on each failed reconnect.
        valkey.on("error", (error: Error) => {
          logger.error(`Valkey connection error: ${error.message}`);
        });
        return valkey;
      },
    },
  ],
  exports: [VALKEY],
})
export class ValkeyModule implements OnApplicationShutdown {
  constructor(@InjectValkey() private readonly valkey: Valkey) {}

  // quit() needs a connection: without one it fails, and the client keeps reconnecting.
  async onApplicationShutdown(): Promise<void> {
    if (this.valkey.status === "ready") await this.valkey.quit();
    else this.valkey.disconnect();
  }
}
