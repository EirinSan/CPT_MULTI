export function parseIpv4(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function formatIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function isIpv4(s: string): boolean {
  return parseIpv4(s) !== null;
}

/** Prefix length of a contiguous mask, or null if the mask is not contiguous. */
export function maskToPrefix(mask: string): number | null {
  const n = parseIpv4(mask);
  if (n === null) return null;
  const inverted = ~n >>> 0;
  // A contiguous mask inverted is 2^k - 1.
  if ((inverted & (inverted + 1)) !== 0) return null;
  return 32 - Math.log2(inverted + 1);
}

export function isMask(s: string): boolean {
  return maskToPrefix(s) !== null;
}

export function networkOf(address: string, mask: string): string {
  return formatIpv4((parseIpv4(address)! & parseIpv4(mask)!) >>> 0);
}
