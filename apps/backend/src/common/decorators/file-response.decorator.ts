import { applyDecorators, SetMetadata, type StreamableFile } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

export const FILE_RESPONSE_KEY = "fileResponse";

/**
 * Declares that a handler answers with a file of one of `mediaTypes`, in place of `@Serialize`: a file has no schema.
 * Bound to the handler's return type, so it can only go on a handler that returns a `StreamableFile`.
 */
export function FileResponse(...mediaTypes: [string, ...string[]]) {
  return <Method extends (...args: never[]) => StreamableFile | Promise<StreamableFile>>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<Method>,
  ): void => {
    const binary = { schema: { type: "string", format: "binary" } };
    applyDecorators(
      SetMetadata(FILE_RESPONSE_KEY, mediaTypes),
      ApiOkResponse({ content: Object.fromEntries(mediaTypes.map((mediaType) => [mediaType, binary])) }),
    )(target, propertyKey, descriptor);
  };
}
