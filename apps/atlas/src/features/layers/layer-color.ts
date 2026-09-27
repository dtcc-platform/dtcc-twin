// Distinct on the Bright basemap and from each other; picked by job id, so a layer keeps its colour.
const palette = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599"];

export function layerColor(jobId: string): string {
  let sum = 0;
  for (const character of jobId) sum += character.charCodeAt(0);
  return palette[sum % palette.length] ?? "#1c7ed6";
}
