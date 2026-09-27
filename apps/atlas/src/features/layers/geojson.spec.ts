import { describe, expect, it } from "vitest";
import { extentOf, toMapCoordinates } from "./geojson";

// The demo area's south-west corner, and where proj4 puts it on the EPSG:3006 grid.
const corner = { wgs84: [11.97, 57.686], sweref: [319370.1, 6397790.4] };

function collection(...geometries: GeoJSON.Geometry[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: geometries.map((geometry) => ({ type: "Feature", geometry, properties: { id: 1 } })),
  };
}

function expectCloseTo(actual: GeoJSON.Position | undefined, expected: number[]) {
  expect(actual?.[0]).toBeCloseTo(expected[0] ?? Number.NaN, 5);
  expect(actual?.[1]).toBeCloseTo(expected[1] ?? Number.NaN, 5);
}

describe("toMapCoordinates", () => {
  it("converts EPSG:3006 coordinates to WGS84 at every depth, keeping properties", () => {
    const ring = [corner.sweref, [319400, 6397790.4], [319400, 6397820], corner.sweref];
    const converted = toMapCoordinates(
      collection(
        { type: "Point", coordinates: corner.sweref },
        { type: "LineString", coordinates: [corner.sweref, corner.sweref] },
        { type: "MultiPolygon", coordinates: [[ring]] },
      ),
      "EPSG:3006",
    );

    const [point, line, polygons] = converted.features.map((feature) => feature.geometry);
    expectCloseTo(point?.type === "Point" ? point.coordinates : undefined, corner.wgs84);
    expectCloseTo(line?.type === "LineString" ? line.coordinates[1] : undefined, corner.wgs84);
    expectCloseTo(polygons?.type === "MultiPolygon" ? polygons.coordinates[0]?.[0]?.[3] : undefined, corner.wgs84);
    expect(converted.features[0]?.properties).toEqual({ id: 1 });
  });

  it("leaves WGS84 as it is, which GeoJSON assumes when it names no system", () => {
    const original = collection({ type: "Point", coordinates: corner.wgs84 });

    expect(toMapCoordinates(original, "EPSG:4326")).toEqual(original);
    expect(toMapCoordinates(original, null)).toEqual(original);
  });
});

describe("extentOf", () => {
  it("answers the west, south, east and north edges of all the coordinates", () => {
    const extent = extentOf(
      collection(
        { type: "Point", coordinates: [11.97, 57.69] },
        {
          type: "Polygon",
          coordinates: [
            [
              [11.96, 57.68],
              [11.99, 57.68],
              [11.99, 57.7],
              [11.96, 57.68],
            ],
          ],
        },
      ),
    );

    expect(extent).toEqual([11.96, 57.68, 11.99, 57.7]);
  });

  it("answers nothing for a collection without coordinates", () => {
    expect(extentOf(collection())).toBeNull();
  });
});
