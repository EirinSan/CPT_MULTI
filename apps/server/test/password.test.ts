import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});
