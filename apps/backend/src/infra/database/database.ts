import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DrizzleModuleAsyncOptions } from "@nestjs/drizzle";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { EnvConfigService } from "../../config/env.schema.js";
import { relations } from "./relations.js";

/** Inject with `@InjectDrizzle() db: Database`. */
export type Database = NodePgDatabase<typeof relations> & { $client: pg.Pool };

const logger = new Logger("Database");

export const databaseModuleOptions: DrizzleModuleAsyncOptions<Database> = {
  inject: [ConfigService],
  useFactory: (config: EnvConfigService) => {
    // Connects on first query, so the app boots without a database.
    const pool = new pg.Pool({
      connectionString: config.get("DATABASE_URL", { infer: true }),
      // pg's default is to wait forever, hanging every request while the server is unresponsive.
      connectionTimeoutMillis: 5_000,
    });
    // Without a listener, a dropped idle connection crashes the process; the pool reconnects on its
    // own. Log the message only: a pg error carries its client, password included.
    pool.on("error", (error) => {
      logger.error(`Idle database connection lost: ${error.message}`);
    });
    return { db: drizzle({ client: pool, relations }) };
  },
};
