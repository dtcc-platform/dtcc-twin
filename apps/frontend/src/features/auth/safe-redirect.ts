/**
 * `?redirect=` if it is a path on this site, else home, so a crafted login link can't send users
 * elsewhere. `//host` and `/\host` are other sites to a browser.
 */
export function safeRedirect(target: string | undefined): string {
  if (!target?.startsWith("/")) return "/";
  if (target.startsWith("//") || target.startsWith("/\\")) return "/";
  return target;
}
