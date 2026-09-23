import { randomBytes } from "node:crypto";
import "dotenv/config";

/** Short secrets (like the old `change-me` example) can be guessed, so tokens could be forged. */
const MIN_SECRET_LENGTH = 32;

export function resolveJwtSecret(env: NodeJS.ProcessEnv, warn: (msg: string) => void = console.warn): string {
  const secret = env.JWT_SECRET;
  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET is too weak: use at least ${MIN_SECRET_LENGTH} random characters (e.g. \`openssl rand -hex 32\`)`,
      );
    }
    return secret;
  }
  if (env.NODE_ENV === "production") throw new Error("JWT_SECRET must be set in production");
  warn("JWT_SECRET is not set: using a random secret, sessions will not survive a restart.");
  return randomBytes(32).toString("hex");
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: resolveJwtSecret(process.env),
  /** Max CLI lines accepted in one replay (anti-abuse). */
  maxCommands: 2000,
  maxLineLength: 256,
};
