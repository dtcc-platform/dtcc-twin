import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, verifyUnknownUser } from "./password.js";

describe("hashPassword", () => {
  it("stores argon2id with its parameters in the PHC string format", async () => {
    expect(await hashPassword("correct horse")).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });

  it("salts every hash, so equal passwords hash differently", async () => {
    expect(await hashPassword("correct horse")).not.toBe(await hashPassword("correct horse"));
  });
});

describe("verifyPassword", () => {
  it("accepts the password that was hashed and rejects any other", async () => {
    const hash = await hashPassword("correct horse");

    expect(await verifyPassword(hash, "correct horse")).toBe(true);
    expect(await verifyPassword(hash, "correct horse ")).toBe(false);
    expect(await verifyPassword(hash, "Correct horse")).toBe(false);
  });

  it("verifies with the parameters stored in the hash, so raising them later keeps old hashes valid", async () => {
    // "correct horse" with m=8192, t=1, p=1, hashed by the reference implementation (Python's
    // argon2-cffi), so this also proves the format is the standard one other tools read and write.
    const older = "$argon2id$v=19$m=8192,t=1,p=1$THfgTCcWX82A942SLnRmOQ$zYizzRCTT5Udpjnl4A3RS9eTXKdx3KkJHORFivogh1M";

    expect(await verifyPassword(older, "correct horse")).toBe(true);
  });

  it("treats the composed and decomposed forms of a character as the same password", async () => {
    // The same visible text: "é" as one code point, then as "e" plus a combining accent.
    const hash = await hashPassword("caf\u00e9 au lait");

    expect(await verifyPassword(hash, "cafe\u0301 au lait")).toBe(true);
  });

  it("throws on a string that is not an argon2id hash rather than answering false", async () => {
    await expect(verifyPassword("plaintext", "plaintext")).rejects.toThrow();
  });
});

describe("verifyUnknownUser", () => {
  it("runs a verification that completes whatever the password", async () => {
    await expect(verifyUnknownUser("correct horse")).resolves.toBeUndefined();
  });
});
