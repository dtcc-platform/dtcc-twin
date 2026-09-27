import { sweref } from "@/lib/sweref";

/** West, south, east, north in degrees. */
export type Extent = [number, number, number, number];

type Convert = (position: GeoJSON.Position) => GeoJSON.Position;

/** The collection in WGS84, which the map draws in; `crs` is the one its artifact declares. */
export function toMapCoordinates(collection: GeoJSON.FeatureCollection, crs: string | null): GeoJSON.FeatureCollection {
  if (crs !== "EPSG:3006") return collection;
  const toDegrees: Convert = ([x = 0, y = 0, ...rest]) => [...sweref.inverse([x, y]), ...rest];
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      ...feature,
      geometry: convertGeometry(feature.geometry, toDegrees),
    })),
  };
}

export function extentOf(collection: GeoJSON.FeatureCollection): Extent | null {
  const positions = collection.features.flatMap((feature) => positionsOf(feature.geometry));
  if (positions.length === 0) return null;
  const longitudes = positions.map(([longitude = 0]) => longitude);
  const latitudes = positions.map(([, latitude = 0]) => latitude);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
}

function convertGeometry(geometry: GeoJSON.Geometry, convert: Convert): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return { ...geometry, coordinates: convert(geometry.coordinates) };
    case "MultiPoint":
    case "LineString":
      return { ...geometry, coordinates: geometry.coordinates.map(convert) };
    case "MultiLineString":
    case "Polygon":
      return { ...geometry, coordinates: geometry.coordinates.map((line) => line.map(convert)) };
    case "MultiPolygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => polygon.map((line) => line.map(convert))),
      };
    case "GeometryCollection":
      return { ...geometry, geometries: geometry.geometries.map((part) => convertGeometry(part, convert)) };
  }
}

function positionsOf(geometry: GeoJSON.Geometry): GeoJSON.Position[] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    case "GeometryCollection":
      return geometry.geometries.flatMap(positionsOf);
  }
}
