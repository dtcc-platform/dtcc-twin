import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import type { EnvConfigService } from "./config/env.schema.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const config: EnvConfigService = app.get(ConfigService);
  await app.listen(config.get("PORT", { infer: true }));
}
await bootstrap();
