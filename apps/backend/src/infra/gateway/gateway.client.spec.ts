import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStubGateway, type StubGateway } from "../../../test/helpers/stub-gateway.js";
import type { Env } from "../../config/env.schema.js";
import { GatewayClient } from "./gateway.client.js";
import { GatewayUnavailableError } from "./gateway.errors.js";

const username = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";
const credentialId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8c";

function clientFor(env: Partial<Env>): GatewayClient {
  return new GatewayClient(new ConfigService<Env, true>(env));
}

describe("GatewayClient", () => {
  let gateway: StubGateway;
  let client: GatewayClient;

  beforeAll(async () => {
    gateway = await startStubGateway();
    client = clientFor({ APISIX_ADMIN_URL: `${gateway.url}/`, APISIX_ADMIN_KEY: gateway.adminKey });
  });

  afterAll(async () => {
    await gateway.close();
  });

  beforeEach(() => {
    gateway.reset();
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("adds a key to a consumer it creates, and keeps the consumer's other keys when it puts it again", async () => {
    await client.putCredential(username, credentialId, "dtcc_first");
    await client.putCredential(username, "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8d", "dtcc_second");

    expect(gateway.credentials(username)).toEqual({
      [credentialId]: "dtcc_first",
      "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8d": "dtcc_second",
    });
  });

  it("deletes one key, and treats a key that is already gone as deleted", async () => {
    await client.putCredential(username, credentialId, "dtcc_first");

    await client.deleteCredential(username, credentialId);
    await client.deleteCredential(username, credentialId);

    expect(gateway.credentials(username)).toEqual({});
  });

  it("deletes a consumer with every key, and treats a consumer that is already gone as deleted", async () => {
    await client.putCredential(username, credentialId, "dtcc_first");

    await client.deleteConsumer(username);
    await client.deleteConsumer(username);

    expect(gateway.consumers()).toEqual([]);
  });

  it("throws GatewayUnavailableError when APISIX fails, is unreachable, or rejects the admin key", async () => {
    gateway.setFailing(true);
    await expect(client.putCredential(username, credentialId, "dtcc_first")).rejects.toThrow(GatewayUnavailableError);
    await expect(client.deleteConsumer(username)).rejects.toThrow(GatewayUnavailableError);

    gateway.setFailing(false);
    gateway.setReachable(false);
    await expect(client.deleteCredential(username, credentialId)).rejects.toThrow(GatewayUnavailableError);

    gateway.setReachable(true);
    const wrongKey = clientFor({ APISIX_ADMIN_URL: gateway.url, APISIX_ADMIN_KEY: "wrong" });
    await expect(wrongKey.deleteConsumer(username)).rejects.toThrow(GatewayUnavailableError);
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining("APISIX_ADMIN_KEY"));
  });

  it("throws GatewayUnavailableError when it isn't configured", async () => {
    await expect(clientFor({}).putCredential(username, credentialId, "dtcc_first")).rejects.toThrow(
      GatewayUnavailableError,
    );
  });
});
