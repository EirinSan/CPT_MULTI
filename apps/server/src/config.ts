import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProd) throw new Error("JWT_SECRET must be set in production");
  return "dev-only-insecure-secret";
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: jwtSecret(),
  /** Max CLI lines accepted in one replay (anti-abuse). */
  maxCommands: 2000,
  maxLineLength: 256,
};
