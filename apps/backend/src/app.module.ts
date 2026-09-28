import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DrizzleModule } from "@nestjs/drizzle";
import { configModuleOptions } from "./config/config.module.js";
import { databaseModuleOptions } from "./infra/database/database.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ItemsModule } from "./modules/items/items.module.js";
import { SettingsModule } from "./modules/settings/settings.module.js";
import { UsersModule } from "./modules/users/users.module.js";

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions()),
    DrizzleModule.forRootAsync(databaseModuleOptions),
    HealthModule,
    UsersModule,
    AuthModule,
    SettingsModule,
    ItemsModule,
  ],
})
export class AppModule {}
