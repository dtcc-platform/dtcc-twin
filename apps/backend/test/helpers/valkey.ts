import { once } from "node:events";
import type { INestApplication } from "@nestjs/common";
import type { Valkey } from "iovalkey";
import { VALKEY } from "../../src/infra/valkey/valkey.module.js";

/**
 * Waits for the app's Valkey client to connect. It connects in the background and fails commands
 * until it has, so a file whose first command needs Valkey calls this after `createTestApp()`.
 */
export async function waitForValkey(app: INestApplication): Promise<void> {
  const valkey = app.get<Valkey>(VALKEY);
  if (valkey.status !== "ready") await once(valkey, "ready");
}
