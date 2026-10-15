import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { GatewayUnavailableError } from "./gateway.errors.js";

const timeoutMs = 10_000;

type Method = "PUT" | "DELETE";

/**
 * The APISIX Admin API, the only code that knows its routes and admin key. A user is one consumer named by their id,
 * and each of their API keys one `key-auth` credential on it. Every failure throws `GatewayUnavailableError`.
 */
@Injectable()
export class GatewayClient {
  private readonly logger = new Logger(GatewayClient.name);
  private readonly baseUrl: string | undefined;
  private readonly adminKey: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get("APISIX_ADMIN_URL", { infer: true })?.replace(/\/+$/, "");
    this.adminKey = config.get("APISIX_ADMIN_KEY", { infer: true });
    if (!this.baseUrl) {
      this.logger.warn("The API gateway is not configured: APISIX_ADMIN_URL is empty, so API keys answer 503");
    }
  }

  /** Adds the key to the user's consumer, creating the consumer if it doesn't exist yet. */
  async putCredential(username: string, credentialId: string, key: string): Promise<void> {
    // Putting an existing consumer again leaves its credentials alone.
    await this.call("PUT", "/consumers", { username }, [200, 201]);
    await this.call("PUT", credentialPath(username, credentialId), { plugins: { "key-auth": { key } } }, [200, 201]);
  }

  async deleteCredential(username: string, credentialId: string): Promise<void> {
    // A 404 means it's already gone, which is what deleting asked for.
    await this.call("DELETE", credentialPath(username, credentialId), undefined, [200, 404]);
  }

  /** Deletes the consumer and, with it, every key it holds. */
  async deleteConsumer(username: string): Promise<void> {
    await this.call("DELETE", `/consumers/${encodeURIComponent(username)}`, undefined, [200, 404]);
  }

  private async call(method: Method, path: string, body: unknown, accepted: number[]): Promise<void> {
    if (!this.baseUrl) throw new GatewayUnavailableError();
    const url = `${this.baseUrl}/apisix/admin${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        // Sent even when unset, so APISIX's 401 reports the missing key.
        headers: { "x-api-key": this.adminKey ?? "", "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`${method} ${url} failed: ${reasonOf(error)}`);
      throw new GatewayUnavailableError();
    }

    // Never logged: a credential's body carries the key.
    await response.body?.cancel().catch(() => undefined);
    if (accepted.includes(response.status)) return;
    if (response.status === 401) {
      this.logger.error(`${url}: APISIX rejected APISIX_ADMIN_KEY`);
    } else {
      this.logger.warn(`${method} ${url} answered ${String(response.status)}`);
    }
    throw new GatewayUnavailableError();
  }
}

function credentialPath(username: string, credentialId: string): string {
  return `/consumers/${encodeURIComponent(username)}/credentials/${encodeURIComponent(credentialId)}`;
}

// fetch rejects with a bare "fetch failed" and keeps the useful part, such as ECONNREFUSED, in its cause.
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
