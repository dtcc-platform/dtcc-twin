import { Logger } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { configModuleOptions } from "./config/config.module.js";
import type { EnvConfigService } from "./config/env.schema.js";
import { migrateDatabase } from "./infra/database/migrations.js";

// `node dist/migrate.js`: run once before each release's backend starts. It validates the same environment as main.ts.
const logger = new Logger("Migrations");
const app = await NestFactory.createApplicationContext(ConfigModule.forRoot(configModuleOptions()));
try {
  const config: EnvConfigService = app.get(ConfigService);
  await migrateDatabase(config.get("DATABASE_URL", { infer: true }));
  logger.log("The database schema is up to date");
} finally {
  await app.close();
}
