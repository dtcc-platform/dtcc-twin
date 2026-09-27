import { SerializeOptions } from "@nestjs/common";
import type { StandardSchemaV1 } from "@standard-schema/spec";

/** Metadata key `@SerializeOptions` writes under; Nest doesn't export it. */
export const SERIALIZE_OPTIONS_KEY = SerializeOptions({}).KEY;

/**
 * `@SerializeOptions({ schema })` bound to the handler's return type, so a mismatched contract is a
 * compile error instead of a 500. Bound to the schema's input, so output transforms still work.
 */
export function Serialize<Input>(schema: StandardSchemaV1<Input, unknown>) {
  return <Method extends (...args: never[]) => Input | Promise<Input>>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<Method>,
  ): void => {
    SerializeOptions({ schema })(target, propertyKey, descriptor);
  };
}
