/** Routing table computed from device state (connected + static). */
import { interfaceStatus } from "./device";
import { maskToPrefix, networkOf, parseIpv4 } from "./net";
import type { DeviceState } from "./types";

export interface RibEntry {
  code: "C" | "L" | "S";
  network: string;
  prefixLength: number;
  nextHop?: string;
  outInterface?: string;
}

function contains(network: string, len: number, ip: string): boolean {
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return ((parseIpv4(ip)! & mask) >>> 0) === parseIpv4(network);
}

export function computeRib(dev: DeviceState): RibEntry[] {
  const rib: RibEntry[] = [];
  for (const i of dev.interfaces) {
    if (!i.ipv4 || interfaceStatus(dev, i).protocol !== "up") continue;
    const len = maskToPrefix(i.ipv4.mask)!;
    rib.push({ code: "C", network: networkOf(i.ipv4.address, i.ipv4.mask), prefixLength: len, outInterface: i.name });
    if (len < 32) rib.push({ code: "L", network: i.ipv4.address, prefixLength: 32, outInterface: i.name });
  }
  const connected = rib.filter((r) => r.code === "C");
  for (const r of dev.staticRoutes) {
    // Like IOS, a static route is installed only if its next hop is reachable.
    const via = connected.find((c) => contains(c.network, c.prefixLength, r.nextHop));
    if (!via) continue;
    rib.push({ code: "S", network: r.network, prefixLength: maskToPrefix(r.mask)!, nextHop: r.nextHop });
  }
  return rib;
}
