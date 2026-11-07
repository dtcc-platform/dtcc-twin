import { Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Valkey } from "iovalkey";
import type { EnvConfigService } from "../../config/env.schema.js";

const logger = new Logger("Valkey");

/** Provides the Valkey client: inject it as `Valkey`. */
@Module({
  providers: [
    {
      provide: Valkey,
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
  exports: [Valkey],
})
export class ValkeyModule implements OnApplicationShutdown {
  constructor(private readonly valkey: Valkey) {}

  // Not quit(): while disconnected it fails without stopping the reconnect timer, which keeps the process alive.
  onApplicationShutdown(): void {
    this.valkey.disconnect();
  }
}
