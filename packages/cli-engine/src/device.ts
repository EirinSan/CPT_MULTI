import type { DeviceState, InterfaceState, InterfaceType, IosDeviceKind } from "./types";

export const INTERFACE_TYPES: Record<InterfaceType, { abbrev: string; help: string }> = {
  FastEthernet: { abbrev: "Fa", help: "FastEthernet IEEE 802.3" },
  GigabitEthernet: { abbrev: "Gi", help: "GigabitEthernet IEEE 802.3z" },
  Loopback: { abbrev: "Lo", help: "Loopback interface" },
  Vlan: { abbrev: "Vl", help: "Catalyst Vlans" },
};

function physical(type: InterfaceType, number: string, switched: boolean): InterfaceState {
  return {
    name: `${type}${number}`,
    type,
    number,
    // Switch ports ship enabled, router ports ship shut down (as on real IOS).
    adminUp: switched,
    carrier: false,
    switchport: switched ? { mode: "access", accessVlan: 1 } : null,
  };
}

export function createDevice(kind: IosDeviceKind, hostname?: string): DeviceState {
  const interfaces: InterfaceState[] = [];
  let model: string;
  if (kind === "router") {
    model = "ISR4331";
    for (let i = 0; i < 3; i++) interfaces.push(physical("GigabitEthernet", `0/0/${i}`, false));
  } else {
    model = kind === "switch-l3" ? "WS-C3650-24PS" : "WS-C2960-24TT-L";
    for (let i = 1; i <= 24; i++) interfaces.push(physical("FastEthernet", `0/${i}`, true));
    for (let i = 1; i <= 2; i++) interfaces.push(physical("GigabitEthernet", `0/${i}`, true));
    interfaces.push({
      name: "Vlan1",
      type: "Vlan",
      number: "1",
      adminUp: false,
      carrier: false,
      switchport: null,
    });
  }
  const vlans = new Map<number, { id: number; name: string }>();
  if (kind !== "router") vlans.set(1, { id: 1, name: "default" });
  return {
    kind,
    hostname: hostname ?? (kind === "router" ? "Router" : "Switch"),
    model,
    interfaces,
    vlans,
    staticRoutes: [],
    macTable: [],
    startupConfig: null,
  };
}

export function shortInterfaceName(i: InterfaceState): string {
  return `${INTERFACE_TYPES[i.type].abbrev}${i.number}`;
}

/** Resolve "g0/1", "Gi0/1", "gigabitethernet0/1", "vlan10"... to a type + number. */
export function parseInterfaceName(raw: string): { type: InterfaceType; number: string } | null {
  const m = /^([a-z]+)\s*(\d+(?:\/\d+)*)$/i.exec(raw.trim());
  if (!m) return null;
  const prefix = m[1]!.toLowerCase();
  const matches = (Object.keys(INTERFACE_TYPES) as InterfaceType[]).filter((t) =>
    t.toLowerCase().startsWith(prefix),
  );
  if (matches.length !== 1) return null;
  return { type: matches[0]!, number: m[2]! };
}

export function isVirtual(i: InterfaceState): boolean {
  return i.type === "Vlan" || i.type === "Loopback";
}

/** Line status as displayed by `show ip interface brief`. */
export function interfaceStatus(dev: DeviceState, i: InterfaceState): {
  status: "up" | "down" | "administratively down";
  protocol: "up" | "down";
} {
  if (!i.adminUp) return { status: "administratively down", protocol: "down" };
  if (i.type === "Loopback") return { status: "up", protocol: "up" };
  if (i.type === "Vlan") {
    // An SVI is up when at least one up access/trunk port carries its VLAN.
    const vid = Number(i.number);
    const up = dev.vlans.has(vid) && dev.interfaces.some(
      (p) =>
        !isVirtual(p) &&
        p.adminUp &&
        p.carrier &&
        p.switchport !== null &&
        (p.switchport.mode === "trunk" || p.switchport.accessVlan === vid),
    );
    return up ? { status: "up", protocol: "up" } : { status: "down", protocol: "down" };
  }
  return i.carrier ? { status: "up", protocol: "up" } : { status: "down", protocol: "down" };
}
