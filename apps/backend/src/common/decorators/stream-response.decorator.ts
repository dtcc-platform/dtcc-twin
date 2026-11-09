import { applyDecorators, SetMetadata } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { z } from "zod";

export const STREAM_RESPONSE_KEY = "streamResponse";

/** Declares an event stream; each event is validated against the schema before writing. */
export function StreamResponse(schema: z.ZodType): MethodDecorator {
  return applyDecorators(
    SetMetadata(STREAM_RESPONSE_KEY, schema),
    ApiOkResponse({ content: { "text/event-stream": { schema: { type: "string" } } } }),
  );
}
