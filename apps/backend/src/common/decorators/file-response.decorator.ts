import { applyDecorators, SetMetadata, type StreamableFile } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

export const FILE_RESPONSE_KEY = "fileResponse";

/**
 * Declares that a handler answers with a file of `mediaType`, in place of `@Serialize`: a file has no schema. Bound
 * to the handler's return type, so it can only go on a handler that returns a `StreamableFile`.
 */
export function FileResponse(mediaType: string) {
  return <Method extends (...args: never[]) => StreamableFile | Promise<StreamableFile>>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<Method>,
  ): void => {
    applyDecorators(
      SetMetadata(FILE_RESPONSE_KEY, mediaType),
      ApiOkResponse({ content: { [mediaType]: { schema: { type: "string", format: "binary" } } } }),
    )(target, propertyKey, descriptor);
  };
}
