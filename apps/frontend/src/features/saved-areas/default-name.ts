const format = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** The name a saved area starts with, as the old Atlas named it: when it was saved. */
export function defaultAreaName(date = new Date()): string {
  return `Area ${format.format(date)}`;
}
