import { SignJWT, UnsecuredJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../common/decorators/auth.decorators.js";
import { signAccessToken, verifyAccessToken } from "./access-tokens.js";

const key = new TextEncoder().encode("a-test-secret-that-is-32-chars-long");
const otherKey = new TextEncoder().encode("another-secret-that-is-32-chars-long");

const user: AuthUser = {
  userId: "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b",
  sessionId: "0199a6b4-7c1e-7d2a-9f3b-000000000001",
  role: "user",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("access tokens", () => {
  it("verify back to the user they were signed for", async () => {
    const token = await signAccessToken(user, key);

    expect(await verifyAccessToken(token, key)).toEqual(user);
  });

  it("expire after 15 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-25T10:00:00Z") });
    const token = await signAccessToken(user, key);

    vi.setSystemTime(new Date("2026-09-25T10:14:59Z"));
    expect(await verifyAccessToken(token, key)).toEqual(user);

    vi.setSystemTime(new Date("2026-09-25T10:15:01Z"));
    expect(await verifyAccessToken(token, key)).toBeUndefined();
  });

  it("are rejected when signed with another secret", async () => {
    const token = await signAccessToken(user, otherKey);

    expect(await verifyAccessToken(token, key)).toBeUndefined();
  });

  it("are rejected when their payload was changed", async () => {
    const [header, , signature] = (await signAccessToken(user, key)).split(".");
    const payload = Buffer.from(JSON.stringify({ sub: user.userId, sid: user.sessionId, role: "admin" })).toString(
      "base64url",
    );

    expect(await verifyAccessToken(`${header ?? ""}.${payload}.${signature ?? ""}`, key)).toBeUndefined();
  });

  it("are rejected unsigned (alg: none)", async () => {
    const token = new UnsecuredJWT({ sid: user.sessionId, role: "admin" })
      .setSubject(user.userId)
      .setExpirationTime("30m")
      .encode();

    expect(await verifyAccessToken(token, key)).toBeUndefined();
  });

  it("are rejected when correctly signed but missing a claim", async () => {
    const token = await new SignJWT({ role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.userId)
      .setExpirationTime("30m")
      .sign(key);

    expect(await verifyAccessToken(token, key)).toBeUndefined();
  });

  it("are rejected when they are not a JWT at all", async () => {
    expect(await verifyAccessToken("not-a-token", key)).toBeUndefined();
  });
});
