import { describe, expect, it } from "vitest";
import { resolveJwtSecret } from "../src/config";

const strong = "a".repeat(32);

describe("JWT secret", () => {
  it("rejects the example value and any short secret", () => {
    expect(() => resolveJwtSecret({ JWT_SECRET: "change-me" })).toThrow(/too weak/);
    expect(() => resolveJwtSecret({ JWT_SECRET: "a".repeat(31) })).toThrow(/too weak/);
  });

  it("accepts a long enough secret", () => {
    expect(resolveJwtSecret({ JWT_SECRET: strong })).toBe(strong);
  });

  it("requires a secret in production", () => {
    expect(() => resolveJwtSecret({ NODE_ENV: "production" })).toThrow(/must be set/);
  });

  it("falls back to a random secret elsewhere, different on each start", () => {
    const warn = () => {};
    const a = resolveJwtSecret({}, warn);
    expect(a).toHaveLength(64);
    expect(resolveJwtSecret({}, warn)).not.toBe(a);
  });
});
