import type { Logger } from "@nestjs/common";
import { ModelUnavailableError } from "./model.client.js";

export function providerFailure(
  provider: string,
  error: unknown,
  secret: string | undefined,
  logger: Logger,
): ModelUnavailableError {
  const details =
    error && typeof error === "object" ? (error as { status?: unknown; message?: unknown; error?: unknown }) : {};
  const nested =
    details.error && typeof details.error === "object" ? (details.error as { type?: unknown; error?: unknown }) : {};
  const inner = nested.error && typeof nested.error === "object" ? (nested.error as { type?: unknown }) : nested;
  const status = typeof details.status === "number" ? details.status : null;
  const type = typeof inner.type === "string" ? inner.type.replace(/[^a-z0-9_]/gi, "_").slice(0, 80) : "unavailable";
  const raw = typeof details.message === "string" ? details.message : "Provider request failed";
  const message = secret ? raw.replaceAll(secret, "[redacted]") : raw;
  logger.warn(JSON.stringify({ provider, status, type, message }));
  return new ModelUnavailableError(
    "The model provider could not answer the request",
    `${provider}_${type}${status === null ? "" : `_${String(status)}`}`,
  );
}
