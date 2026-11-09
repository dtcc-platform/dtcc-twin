import type { z } from "zod";

/** Server-sent events from a text stream, each `data:` payload parsed as JSON and validated; invalid frames are skipped. */
export async function* parseEventStream<T>(chunks: AsyncIterable<string>, schema: z.ZodType<T>): AsyncGenerator<T> {
  let pending = "";
  for await (const chunk of chunks) {
    pending = (pending + chunk).replaceAll("\r\n", "\n");
    let boundary: number;
    while ((boundary = pending.indexOf("\n\n")) >= 0) {
      const frame = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      try {
        const event = schema.safeParse(JSON.parse(data));
        if (event.success) yield event.data;
      } catch {
        continue;
      }
    }
  }
}
