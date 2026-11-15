/** A snake_case name as words for people: `wall_bc_type` reads "Wall bc type". */
export function humanize(name: string): string {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
