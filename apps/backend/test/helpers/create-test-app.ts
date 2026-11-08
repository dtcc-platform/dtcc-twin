import type { ModuleMetadata } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";

/** Builds the app the way main.ts does. `metadata` adds test-only controllers or providers. */
export async function createTestApp(metadata: ModuleMetadata = {}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    ...metadata,
    imports: [AppModule, ...(metadata.imports ?? [])],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
