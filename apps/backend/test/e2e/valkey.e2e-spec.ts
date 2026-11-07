import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Valkey } from "iovalkey";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { EnvConfigService } from "../../src/config/env.schema.js";
import { createTestApp } from "../helpers/create-test-app.js";

describe("Valkey client (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // A resent INCR whose first reply was lost would count twice.
  it("fails a command in flight when the connection drops, instead of resending it once reconnected", async () => {
    const valkey = app.get(Valkey);
    const config: EnvConfigService = app.get(ConfigService);
    const other = new Valkey(config.get("VALKEY_URL", { infer: true }));
    onTestFinished(() => {
      other.disconnect();
    });
    const id = await valkey.client("ID");

    // BLPOP on a key nobody pushes to stays in flight until its connection drops.
    const blocked = valkey.blpop(`test:${randomUUID()}`, 0);
    // It rejects before the kill's own reply arrives, so handle it now or Vitest reports it as unhandled.
    blocked.catch(() => undefined);
    await other.client("KILL", "ID", String(id));

    await expect(blocked).rejects.toThrow("max retries");
  });
});
