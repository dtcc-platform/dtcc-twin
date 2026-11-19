import { Logger } from "@nestjs/common";
import { expect, it, vi } from "vitest";
import { modelCost } from "./model.cost.js";
it("prices all four Anthropic token categories independently", () => {
  expect(
    modelCost("anthropic", "claude-sonnet-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    }),
  ).toBe(14.7);
});
it("uses Stockholm geo-inference pricing on Bedrock", () => {
  expect(
    modelCost("bedrock", "eu.anthropic.claude-sonnet-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    }),
  ).toBe(16.06);
});
it("rounds a cost to whole hundred-millionths of a dollar", () => {
  // Unrounded, these counts price at 0.0020548000000000003.
  expect(
    modelCost("bedrock", "eu.anthropic.claude-sonnet-5-5", {
      inputTokens: 4,
      outputTokens: 186,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
  ).toBe(0.0020548);
});
it("has no cost for a model without rates, and warns once per model id", () => {
  const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
  expect(modelCost("bedrock", "eu.anthropic.claude-sonnet-5-5-v9", usage)).toBeNull();
  expect(modelCost("bedrock", "eu.anthropic.claude-sonnet-5-5-v9", usage)).toBeNull();
  expect(warn).toHaveBeenCalledOnce();
  expect(warn.mock.calls[0]?.[0]).toContain("eu.anthropic.claude-sonnet-5-5-v9");
  warn.mockRestore();
});
