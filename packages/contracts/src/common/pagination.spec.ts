import { describe, expect, it } from "vitest";
import { z } from "zod";
import { offsetPage, offsetPaginationQuerySchema } from "./pagination.js";

describe("offsetPaginationQuerySchema", () => {
  it("defaults to the first 20 items", () => {
    expect(offsetPaginationQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("coerces query-string values", () => {
    expect(offsetPaginationQuerySchema.parse({ limit: "50", offset: "100" })).toEqual({ limit: 50, offset: 100 });
  });

  it.each([{ limit: "0" }, { limit: "101" }, { limit: "2.5" }, { limit: "abc" }, { limit: "" }, { offset: "-1" }])(
    "rejects %o",
    (query) => {
      expect(offsetPaginationQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe("offsetPage", () => {
  const usersPageSchema = offsetPage(z.object({ id: z.string() }));

  it("parses a page and strips item keys the item schema does not declare", () => {
    const page = usersPageSchema.parse({
      items: [{ id: "a", passwordHash: "secret" }],
      limit: 20,
      offset: 0,
      total: 1,
    });

    expect(page).toEqual({ items: [{ id: "a" }], limit: 20, offset: 0, total: 1 });
  });
});
