const labels: Record<string, string> = { png: "PNG image", geojson: "GeoJSON", tif: "GeoTIFF" };

/** The formats the map draws, in the order the form prefers them. */
export const mapFormats = ["png", "geojson"];

/** A format's name for people, such as "GeoJSON" for `geojson`. */
export function artifactFormatLabel(format: string): string {
  return labels[format] ?? format.toUpperCase();
}

export function drawsOnMap(format: string | null): boolean {
  return format !== null && mapFormats.includes(format);
}
