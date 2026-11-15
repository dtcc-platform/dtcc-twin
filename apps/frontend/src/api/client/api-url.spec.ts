import { describe, expect, it } from "vitest";
import { isApiUrl } from "./api-url.ts";

const page = "http://localhost:3000/";

describe("isApiUrl", () => {
  it("takes the URLs under a relative base on the page's own origin", () => {
    expect(isApiUrl("/api/jobs/1/artifact", "/api", page)).toBe(true);
    expect(isApiUrl("http://localhost:3000/api/jobs/1/artifact", "/api", page)).toBe(true);
    expect(isApiUrl("/api", "/api", page)).toBe(true);
  });

  it("leaves out other paths and other origins", () => {
    expect(isApiUrl("/apix/jobs", "/api", page)).toBe(false);
    expect(isApiUrl("https://tiles.openfreemap.org/styles/bright", "/api", page)).toBe(false);
  });

  // An API on another origin, set by VITE_API_URL.
  it("compares the whole origin of an absolute base, not its first characters", () => {
    expect(isApiUrl("https://api.example.org/api/jobs", "https://api.example.org/api", page)).toBe(true);
    expect(isApiUrl("https://api.example.org/jobs", "https://api.example.org", page)).toBe(true);
    expect(isApiUrl("https://api.example.org.evil.net/jobs", "https://api.example.org", page)).toBe(false);
    expect(isApiUrl("https://api.example.org/apix", "https://api.example.org/api", page)).toBe(false);
  });
});
