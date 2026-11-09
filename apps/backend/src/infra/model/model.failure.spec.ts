import { Logger } from "@nestjs/common";
import { expect, it, vi } from "vitest";
import { providerFailure } from "./model.failure.js";
it("logs provider diagnostics with a specific code and redacts credentials", () => {
  const logger = new Logger("test");
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  const failure = providerFailure(
    "bedrock",
    { status: 429, error: { type: "throttling_error" }, message: "request failed: fake-secret" },
    "fake-secret",
    logger,
  );
  expect(failure.errorCode).toBe("bedrock_throttling_error_429");
  expect(failure.message).not.toContain("fake-secret");
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      provider: "bedrock",
      status: 429,
      type: "throttling_error",
      message: "request failed: [redacted]",
    }),
  );
});
