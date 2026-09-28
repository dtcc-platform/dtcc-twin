import { HttpStatus, RequestMethod, type StandardSchemaSerializerContextOptions, type Type } from "@nestjs/common";
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
  RouteParamtypes,
} from "@nestjs/common/internal";
import { MetadataScanner } from "@nestjs/core";
import { SERIALIZE_OPTIONS_KEY } from "../../src/common/decorators/serialize.decorator.js";

const validatedParams: Partial<Record<number, string>> = {
  [RouteParamtypes.BODY]: "@Body",
  [RouteParamtypes.QUERY]: "@Query",
  [RouteParamtypes.PARAM]: "@Param",
};

/**
 * Routes whose input or output has no schema. The global validation pipe and serializer skip
 * those silently, so this is what catches them.
 */
export function findContractViolations(controllers: Type[]): string[] {
  const scanner = new MetadataScanner();
  const violations: string[] = [];

  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name] as object;
      if (!Reflect.hasMetadata(PATH_METADATA, handler)) continue;
      const route = describeRoute(controller, handler);

      // Only method-level schemas count: `Serialize` is what ties the schema to the return type.
      const noBody = Reflect.getMetadata(HTTP_CODE_METADATA, handler) === HttpStatus.NO_CONTENT;
      const serializer = Reflect.getMetadata(SERIALIZE_OPTIONS_KEY, handler) as
        StandardSchemaSerializerContextOptions | undefined;
      if (!noBody && !serializer?.schema) {
        violations.push(`${route} declares no response schema (@Serialize)`);
      }

      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<
        string,
        { index: number; schema?: unknown }
      >;
      // Decorators run right to left, so the metadata lists the last parameter first.
      const params = Object.entries(args).sort(([, a], [, b]) => a.index - b.index);
      for (const [key, arg] of params) {
        const decorator = validatedParams[Number(key.split(":")[0])];
        if (decorator && arg.schema === undefined) {
          violations.push(`${route} ${decorator} at index ${String(arg.index)} declares no schema`);
        }
      }
    }
  }
  return violations;
}

function describeRoute(controller: Type, handler: object): string {
  const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
  const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
  const full = `/api/${prefix}/${path}`.replaceAll(/\/+/g, "/").replace(/\/$/, "");
  return `${method} ${full || "/"}`;
}
