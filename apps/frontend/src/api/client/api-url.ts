/** Whether `url` is under the API's `baseUrl`, both read against `page`, the address of the page making the request. */
export function isApiUrl(url: string, baseUrl: string, page: string): boolean {
  const base = new URL(baseUrl, page);
  const target = new URL(url, page);
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return target.origin === base.origin && `${target.pathname}/`.startsWith(basePath);
}
