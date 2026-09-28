import { errorResponseSchema, type ErrorBody } from "@repo/contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody | undefined;

  constructor(status: number, responseBody: unknown, options?: ErrorOptions) {
    // Parsed, not assumed: a proxy's 502 page or a CDN's JSON is not ours, and leaves `body` undefined.
    const parsed = errorResponseSchema.safeParse(responseBody);
    const body = parsed.success ? parsed.data.error : undefined;
    super(body?.message ?? `Request failed with status ${String(status)}`, options);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}
