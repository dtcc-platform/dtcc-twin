interface ViteTypeOptions {
  // import.meta.env only allows the variables declared below.
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  /** API base URL. Defaults to `/api`, which the Vite dev server proxies to the backend. */
  readonly VITE_API_URL?: string;
}
