import { describe, expect, it } from "vitest";
import { boundsSchema, toBoundsFields, type BoundsFields } from "./bounds-form.ts";

const chalmersFields: BoundsFields = { west: "11.97", south: "57.686", east: "11.98", north: "57.692" };

// Each field's message, and the form's under "root", as react-hook-form's zod resolver files them.
function messages(fields: BoundsFields) {
  const issues = boundsSchema.safeParse(fields).error?.issues ?? [];
  return Object.fromEntries(issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("boundsSchema", () => {
  it("reads the four fields as an area", () => {
    expect(boundsSchema.parse({ ...chalmersFields, west: " 11.97 " })).toEqual({
      west: 11.97,
      south: 57.686,
      east: 11.98,
      north: 57.692,
    });
  });

  it("asks for a number in each field", () => {
    expect(messages({ ...chalmersFields, west: "", north: "57,692" })).toEqual({
      west: "Enter a number",
      north: "Enter a number",
    });
  });

  it("keeps latitudes and longitudes in range", () => {
    expect(messages({ ...chalmersFields, south: "-91", east: "181" })).toEqual({
      south: "Latitude runs from -90 to 90",
      east: "Longitude runs from -180 to 180",
    });
  });

  it("puts north above south and east of west", () => {
    expect(messages({ west: "11.98", south: "57.692", east: "11.97", north: "57.686" })).toEqual({
      north: "Must be north of south",
      east: "Must be east of west",
    });
  });

  it("keeps the area's size within the limits", () => {
    expect(messages({ west: "11.97", south: "57.686", east: "11.97001", north: "57.68601" })).toEqual({
      root: "Under the 25 m² minimum",
    });
    expect(messages({ west: "11", south: "57", east: "12", north: "58" })).toEqual({
      root: "Over the 25 km² limit",
    });
  });
});

describe("toBoundsFields", () => {
  it("shows the area in degrees, to six decimals at most", () => {
    expect(toBoundsFields({ west: 11.9700000012, south: 57.686, east: 11.123456789, north: 57.692 })).toEqual({
      west: "11.97",
      south: "57.686",
      east: "11.123457",
      north: "57.692",
    });
  });

  it("leaves the fields empty without an area", () => {
    expect(toBoundsFields(null)).toEqual({ west: "", south: "", east: "", north: "" });
  });
});
