import { expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./agent.prompt.js";
it("names no Dataset tool, since the enabled Datasets come from configuration", () => {
  expect(SYSTEM_PROMPT).not.toMatch(/\brun_[a-z]/);
});
