import {
  HttpStatus,
  RequestMethod,
  type INestApplication,
  type StandardSchemaSerializerContextOptions,
  type Type,
} from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA } from "@nestjs/common/internal";
import { MetadataScanner, ModulesContainer } from "@nestjs/core";
import { ApiResponse, DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { errorResponseSchema } from "@repo/contracts";
import { SERIALIZE_OPTIONS_KEY } from "../common/decorators/serialize.decorator.js";

/** Swagger UI at /api/docs, the document at /api/docs/openapi.json, both built on first request. */
export function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("API")
    .setOpenAPIVersion("3.1.0")
    .addGlobalResponse({ standardSchema: errorResponseSchema, description: "Any failure" })
    .build();

  SwaggerModule.setup(
    "api/docs",
    app,
    () => {
      documentResponses(app);
      return SwaggerModule.createDocument(app, config);
    },
    { jsonDocumentUrl: "api/docs/openapi.json" },
  );
}

// Swagger documents request schemas but not `@Serialize` ones, so each becomes the success response here.
// trap: reads Nest's internal metadata keys; a rename fails typecheck, a changed value fails the docs e2e test.
function documentResponses(app: INestApplication): void {
  const scanner = new MetadataScanner();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type | null;
      if (!controller) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as object;
        const options = Reflect.getMetadata(SERIALIZE_OPTIONS_KEY, handler) as
          StandardSchemaSerializerContextOptions | undefined;
        if (!options?.schema) continue;
        ApiResponse({ status: statusOf(handler), standardSchema: options.schema })(prototype, name, { value: handler });
      }
    }
  }
}

// Mirrors Nest's default: @HttpCode wins, else 201 for POST and 200 otherwise.
function statusOf(handler: object): number {
  const explicit = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
  if (explicit) return explicit;
  return Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.POST ? HttpStatus.CREATED : HttpStatus.OK;
}
