interface ViteTypeOptions {
  // import.meta.env only allows the variables declared below.
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  /** API base URL. Defaults to `/api`, which the Vite dev server proxies to the backend. */
  readonly VITE_API_URL?: string;
  /** CARTO basemaps key; when set, the map offers the old Atlas's Carto Voyager basemap. */
  readonly VITE_CARTO_API_KEY?: string;
}
