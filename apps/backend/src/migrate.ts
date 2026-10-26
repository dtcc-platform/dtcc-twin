import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DrizzleModule } from "@nestjs/drizzle";
import { configModuleOptions } from "./config/config.module.js";
import type { EnvConfigService } from "./config/env.schema.js";
import { databaseModuleOptions } from "./infra/database/database.js";
import { migrateDatabase } from "./infra/database/migrations.js";
import { AccountsModule } from "./modules/accounts/accounts.module.js";
import { AccountsService } from "./modules/accounts/accounts.service.js";

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions()),
    DrizzleModule.forRootAsync(databaseModuleOptions),
    AccountsModule,
  ],
})
class MigrateModule {}

// `node dist/migrate.js`: run once before each release's backend starts. It validates the same environment as main.ts.
const logger = new Logger("Migrations");
const app = await NestFactory.createApplicationContext(MigrateModule);
try {
  const config: EnvConfigService = app.get(ConfigService);
  await migrateDatabase(config.get("DATABASE_URL", { infer: true }));
  logger.log("The database schema is up to date");

  const email = config.get("ADMIN_EMAIL", { infer: true });
  const password = config.get("ADMIN_PASSWORD", { infer: true });
  if ((email === undefined) !== (password === undefined)) {
    throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD, or neither");
  }
  if (email !== undefined && password !== undefined) {
    const admin = await app.get(AccountsService).ensureAdmin(email, password);
    logger.log(admin ? `Created the admin ${admin.email}` : "An active admin exists; ADMIN_EMAIL changed nothing");
  }
} finally {
  await app.close();
}
