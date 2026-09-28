import { themeSchema, type Theme } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { authQueries } from "@/api/auth";
import { settingsQueries } from "@/api/settings";

export type ResolvedTheme = "light" | "dark";

// index.html reads the same key before the app loads, so the first paint already has the theme.
const storageKey = "theme";

// Storage can be blocked (private modes, site-data settings); the theme then just waits for the server.
function readStoredPreference(): Theme | undefined {
  try {
    return themeSchema.safeParse(localStorage.getItem(storageKey)).data;
  } catch {
    return undefined;
  }
}

function storePreference(preference: Theme): void {
  try {
    localStorage.setItem(storageKey, preference);
  } catch {
    // See readStoredPreference.
  }
}

// Only bridges the wait for the server on page load; from then on the queries answer.
const storedPreference = readStoredPreference();

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

function subscribeToScheme(onChange: () => void) {
  darkScheme.addEventListener("change", onChange);
  return () => {
    darkScheme.removeEventListener("change", onChange);
  };
}

function prefersDark() {
  return darkScheme.matches;
}

/** Undefined until the server answers. Nobody logged in means `system`. */
function useServerPreference(): Theme | undefined {
  const me = useQuery(authQueries.me());
  const settings = useQuery({ ...settingsQueries.detail(), enabled: Boolean(me.data) });

  // Checked before settings: logging out keeps the previous user's settings cached (see forgetUser).
  if (me.data === null) return "system";
  return settings.data?.theme;
}

export function useTheme(): ResolvedTheme {
  const serverPreference = useServerPreference();
  const osPrefersDark = useSyncExternalStore(subscribeToScheme, prefersDark);

  const preference = serverPreference ?? storedPreference ?? "system";
  if (preference === "system") return osPrefersDark ? "dark" : "light";
  return preference;
}

/** Call once, at the root: puts the theme on <html> and remembers it for the next page load. */
export function useApplyTheme(): void {
  const theme = useTheme();
  const serverPreference = useServerPreference();

  // On <html>, outside React's tree: body's background and portaled popups live outside #root.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // Native controls (select dropdowns, scrollbars) only follow color-scheme, not the .dark variables.
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (serverPreference) storePreference(serverPreference);
  }, [serverPreference]);
}
