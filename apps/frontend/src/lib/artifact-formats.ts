const labels: Record<string, string> = { png: "PNG image", geojson: "GeoJSON", tif: "GeoTIFF" };

/** A format's name for people, such as "GeoJSON" for `geojson`. */
export function artifactFormatLabel(format: string): string {
  return labels[format] ?? format.toUpperCase();
}
