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

// ---------------------------------------------------------------------------
// MAC addresses
// ---------------------------------------------------------------------------

/** Cisco dotted format: "0001.42ab.cd01". */
export function formatMac(bytes: number[]): string {
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

/** Accepts "0001.42ab.cd01", "00:01:42:ab:cd:01" or "00-01-42-ab-cd-01". */
export function parseMac(s: string): string | null {
  const hex = s.toLowerCase().replace(/[.:-]/g, "");
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s) || /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(s)) {
    return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
  }
  return null;
}

/** Deterministic 32-bit hash (FNV-1a), used to derive stable MACs. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable MAC for a device, with `index` in the last byte. */
export function deriveMac(seed: string, oui: [number, number, number], index = 0): string {
  const h = hash32(seed);
  return formatMac([oui[0], oui[1], oui[2], (h >>> 16) & 255, (h >>> 8) & 255, (h + index) & 255]);
}

// ---------------------------------------------------------------------------
// VLAN lists ("1,10,20-30")
// ---------------------------------------------------------------------------

export function parseVlanList(s: string, min = 1, max = 4094): number[] | null {
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < min || b > max || a > b) return null;
    for (let v = a; v <= b; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

export function formatVlanList(vlans: number[]): string {
  if (vlans.length === 0) return "none";
  const sorted = [...new Set(vlans)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (const v of [...sorted.slice(1), Number.NaN]) {
    if (v === prev + 1) {
      prev = v;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = v;
    prev = v;
  }
  return parts.join(",");
}
