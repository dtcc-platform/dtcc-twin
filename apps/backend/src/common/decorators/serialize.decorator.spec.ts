import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SERIALIZE_OPTIONS_KEY, Serialize } from "./serialize.decorator.js";

const itemSchema = z.object({ id: z.string(), name: z.string() });
type Item = z.infer<typeof itemSchema>;

const rowSchema = z.object({ id: z.string(), createdAt: z.date().transform((date) => date.toISOString()) });
type Row = z.input<typeof rowSchema>;

class Handlers {
  @Serialize(itemSchema)
  item(): Promise<Item> {
    return Promise.resolve({ id: "item-1", name: "Widget" });
  }

  @Serialize(rowSchema)
  row(): Row {
    return { id: "row-1", createdAt: new Date() };
  }

  // @ts-expect-error a handler returns what its schema accepts, not another schema's shape
  @Serialize(itemSchema)
  wrongSchema(): Row {
    return { id: "row-1", createdAt: new Date() };
  }
}

describe("Serialize", () => {
  it("records the schema where the serializer interceptor reads it", () => {
    expect(Reflect.getMetadata(SERIALIZE_OPTIONS_KEY, Handlers.prototype.item)).toEqual({ schema: itemSchema });
  });

  it("binds the handler to the schema's input, so a transforming schema takes the raw value", () => {
    expect(Reflect.getMetadata(SERIALIZE_OPTIONS_KEY, Handlers.prototype.row)).toEqual({ schema: rowSchema });
  });
});
