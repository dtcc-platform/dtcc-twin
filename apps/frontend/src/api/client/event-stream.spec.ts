import { agentEventSchema } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { parseEventStream } from "./event-stream";
function* chunks(...items: string[]) {
  yield* items;
}
async function* input(...items: string[]) {
  for (const item of chunks(...items)) {
    await Promise.resolve();
    yield item;
  }
}
describe("event stream", () => {
  it("reassembles a split frame", async () => {
    expect(
      await collect(parseEventStream(input('data: {"type":"text",', '"delta":"Hello"}\n\n'), agentEventSchema)),
    ).toEqual([{ type: "text", delta: "Hello" }]);
  });
  it("reads multiple frames and skips malformed or invalid frames", async () => {
    expect(
      await collect(
        parseEventStream(
          input(
            'data: nope\n\ndata: {"type":"text"}\n\ndata: {"type":"status","message":"Working"}\r\n\r\ndata: {"type":"text","delta":"Hi"}\n\n',
          ),
          agentEventSchema,
        ),
      ),
    ).toEqual([
      { type: "status", message: "Working" },
      { type: "text", delta: "Hi" },
    ]);
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}
