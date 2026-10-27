/** The first letters of the first and last words: "Ana María López" is "AL", "Ada" is "A". */
export function initials(name: string): string {
  // Array.from splits by code point, so a letter outside the BMP isn't cut in half.
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => Array.from(word)[0]);
  const picked = letters.length > 1 ? [letters[0], letters.at(-1)] : letters;
  return picked.join("").toUpperCase() || "?";
}
