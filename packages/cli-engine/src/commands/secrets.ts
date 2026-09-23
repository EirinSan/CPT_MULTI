import { type7Decode } from "../passwords";
import type { CommandContext } from "../session";
import { splitTypedSecret } from "./helpers";

/** "cisco" or "7 0822455D0A16" -> plain text (null if invalid). */
export function plainOrType7(ctx: CommandContext, text: string): string | null {
  const { type, value } = splitTypedSecret(text);
  if (type === 7) {
    const plain = type7Decode(value);
    if (plain === null) ctx.print("Invalid encrypted password");
    return plain;
  }
  return type === null || type === 0 ? value : null;
}
