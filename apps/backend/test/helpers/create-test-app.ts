import { once } from "node:events";
import type { ModuleMetadata } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Valkey } from "iovalkey";
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
  // Valkey connects in the background, so a test's first command would race it. once() rejects on
  // a failed first attempt instead, which is all a file without a reachable Valkey needs.
  const valkey = app.get(Valkey);
  if (valkey.status !== "ready") await once(valkey, "ready").catch(() => undefined);
  return app;
}
