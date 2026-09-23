/**
 * Password storage as displayed by IOS. Type 7 is Cisco's reversible
 * obfuscation (service password-encryption); secrets use a salted one-way
 * hash shown as type 9. The hash is NOT scrypt: it only has to look and
 * behave like one inside the simulator (and stay deterministic so that the
 * server's replay produces the same running-config as the client).
 */
import { hash32 } from "./net";
import type { SecretHash } from "./types";

const XLAT = "dsfd;kfoA,.iyewrkldJKDHSUBsgvca69834ncxv9873254k;fg87";

export function type7Encode(plain: string, seed = plain.length % 16): string {
  let out = String(seed).padStart(2, "0");
  for (let i = 0; i < plain.length; i++) {
    const x = plain.charCodeAt(i) ^ XLAT.charCodeAt((seed + i) % XLAT.length);
    out += x.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function type7Decode(encoded: string): string | null {
  if (!/^\d{2}([0-9A-Fa-f]{2})*$/.test(encoded)) return null;
  const seed = Number(encoded.slice(0, 2));
  let out = "";
  for (let i = 2, j = 0; i < encoded.length; i += 2, j++) {
    out += String.fromCharCode(parseInt(encoded.slice(i, i + 2), 16) ^ XLAT.charCodeAt((seed + j) % XLAT.length));
  }
  return out;
}

const ALPHABET = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function encode(seed: string, length: number): string {
  let out = "";
  let h = hash32(seed);
  for (let i = 0; i < length; i++) {
    h = hash32(`${h}:${seed}:${i}`);
    out += ALPHABET[h % ALPHABET.length];
  }
  return out;
}

export function hashSecret(plain: string, salt = encode(`salt:${plain}`, 14)): SecretHash {
  return { salt, hash: encode(`${salt}$${plain}`, 43) };
}

export function verifySecret(plain: string, secret: SecretHash): boolean {
  return hashSecret(plain, secret.salt).hash === secret.hash;
}

export function formatSecret(secret: SecretHash): string {
  return `9 $9$${secret.salt}$${secret.hash}`;
}

/** Parses "$9$salt$hash" as printed in a running-config. */
export function parseSecret(text: string): SecretHash | null {
  const m = /^\$9\$([./0-9A-Za-z]+)\$([./0-9A-Za-z]+)$/.exec(text);
  return m ? { salt: m[1]!, hash: m[2]! } : null;
}
