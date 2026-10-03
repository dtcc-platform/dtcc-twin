import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Dataset } from "@repo/contracts";
import type { Env } from "../../config/env.schema.js";
import { EngineUnavailableError } from "./engine.errors.js";
import { engineCatalogSchema, engineDescriptorSchema, type EngineDescriptor } from "./engine.schemas.js";

const timeoutMs = 10_000;

/**
 * DTCC Engine's HTTP API, the only code that knows its routes, token and response shapes. Every failure to get an
 * expected answer throws `EngineUnavailableError`; callers decide what that means for their route.
 */
@Injectable()
export class EngineClient {
  private readonly logger = new Logger(EngineClient.name);
  private readonly baseUrl: string | undefined;
  private readonly token: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get("ENGINE_URL", { infer: true })?.replace(/\/+$/, "");
    this.token = config.get("ENGINE_API_TOKEN", { infer: true });
    if (!this.baseUrl) this.logger.warn("DTCC Engine is not configured: ENGINE_URL is empty, so its routes answer 503");
  }

  async listDatasets(): Promise<Dataset[]> {
    const response = await this.send("/datasets");
    if (response.status !== 200) throw this.fail(response, `answered ${String(response.status)}`);

    const catalog = engineCatalogSchema.safeParse(await response.json().catch(() => undefined));
    if (!catalog.success) throw this.fail(response, `sent an unexpected body: ${catalog.error.message}`);
    return Object.values(catalog.data.datasets).map(toDataset);
  }

  /** The Dataset, or null when the engine has none of that name. */
  async getDataset(name: string): Promise<Dataset | null> {
    const response = await this.send(`/datasets/${encodeURIComponent(name)}`);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status !== 200) throw this.fail(response, `answered ${String(response.status)}`);

    const descriptor = engineDescriptorSchema.safeParse(await response.json().catch(() => undefined));
    if (!descriptor.success) throw this.fail(response, `sent an unexpected body: ${descriptor.error.message}`);
    return toDataset(descriptor.data);
  }

  /** Calls the engine with its token; throws if it isn't configured or can't be reached. */
  private async send(path: string): Promise<Response> {
    if (!this.baseUrl) throw new EngineUnavailableError();
    const url = `${this.baseUrl}/api/v1${path}`;
    try {
      return await fetch(url, {
        // Sent even when unset, so the engine's 401 reports the missing token.
        headers: { authorization: `Bearer ${this.token ?? ""}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`${url} failed: ${reasonOf(error)}`);
      throw new EngineUnavailableError();
    }
  }

  /** Logs why a response can't be used and returns the error to throw. */
  private fail(response: Response, reason: string): EngineUnavailableError {
    if (!response.bodyUsed) void response.body?.cancel().catch(() => undefined);
    if (response.status === 401) {
      this.logger.error(`${response.url}: DTCC Engine rejected ENGINE_API_TOKEN`);
    } else {
      this.logger.warn(`${response.url} failed: ${reason}`);
    }
    return new EngineUnavailableError();
  }
}

function toDataset(descriptor: EngineDescriptor): Dataset {
  return {
    name: descriptor.name,
    title: descriptor.title,
    description: descriptor.description,
    dataCategory: descriptor.data_category,
    resultKind: descriptor.result_kind,
    argsSchema: descriptor.args_schema,
    timeoutHint: descriptor.timeout_hint,
  };
}

// fetch rejects with a bare "fetch failed" and keeps the useful part, such as ECONNREFUSED, in its cause.
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
