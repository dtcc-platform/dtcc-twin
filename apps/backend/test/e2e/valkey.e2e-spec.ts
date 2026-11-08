import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Valkey } from "iovalkey";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import type { EnvConfigService } from "../../src/config/env.schema.js";
import { VALKEY } from "../../src/infra/valkey/valkey.module.js";
import { createTestApp } from "../helpers/create-test-app.js";
import { waitForValkey } from "../helpers/valkey.js";

describe("Valkey client (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await waitForValkey(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // A resent INCR whose first reply was lost would count twice.
  it("fails a command in flight when the connection drops, instead of resending it once reconnected", async () => {
    const valkey = app.get<Valkey>(VALKEY);
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

  // Shutdown cannot be undone, so this test gets its own app rather than spoiling the shared one.
  it("ends the client on shutdown", async () => {
    const closing = await createTestApp();
    await waitForValkey(closing);
    const valkey = closing.get<Valkey>(VALKEY);

    await closing.close();

    await vi.waitFor(() => {
      expect(valkey.status).toBe("end");
    });
  });
});
