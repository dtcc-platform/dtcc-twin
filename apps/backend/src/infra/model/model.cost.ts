import { Logger } from "@nestjs/common";
import type { ModelUsage } from "./model.client.js";

// USD per million tokens, by `provider/model`.
const RATES: Record<string, { input: number; output: number; read: number; write: number } | undefined> = {
  "anthropic/claude-sonnet-5-5": { input: 2, output: 10, read: 0.2, write: 2.5 },
  "bedrock/eu.anthropic.claude-sonnet-5-5": { input: 2.2, output: 11, read: 0.11, write: 2.75 },
};
const logger = new Logger("ModelCost");
const unpriced = new Set<string>();

/** The tokens' price in USD to 8 decimals, or null for a model without rates here: nothing blocks on cost. */
export function modelCost(provider: string, model: string, usage: ModelUsage): number | null {
  if (provider === "scripted") return 0;
  const key = `${provider}/${model}`;
  const rates = RATES[key];
  if (!rates) {
    if (!unpriced.has(key)) {
      unpriced.add(key);
      logger.warn(`No token rates for ${key}; its turns are stored without a cost`);
    }
    return null;
  }
  const usd =
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadTokens * rates.read +
      usage.cacheWriteTokens * rates.write) /
    1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}
