import { deriveMac } from "./net";
import type {
  DeviceState,
  InterfaceOper,
  InterfaceState,
  InterfaceType,
  IosDeviceKind,
  LineConfig,
  SwitchportConfig,
} from "./types";

export const INTERFACE_TYPES: Record<InterfaceType, { abbrev: string; help: string }> = {
  FastEthernet: { abbrev: "Fa", help: "FastEthernet IEEE 802.3" },
  GigabitEthernet: { abbrev: "Gi", help: "GigabitEthernet IEEE 802.3z" },
  Loopback: { abbrev: "Lo", help: "Loopback interface" },
  "Port-channel": { abbrev: "Po", help: "Ethernet Channel of interfaces" },
  Vlan: { abbrev: "Vl", help: "Catalyst Vlans" },
};

const CISCO_OUI: [number, number, number] = [0x00, 0x1a, 0x2b];

export function defaultSwitchport(kind: IosDeviceKind): SwitchportConfig {
  return {
    // Catalyst default: DTP "dynamic auto".
    mode: "dynamic-auto",
    accessVlan: 1,
    voiceVlan: null,
    nativeVlan: 1,
    allowedVlans: "all",
    nonegotiate: false,
    encapsulation: kind === "switch-l3" ? "negotiate" : "dot1q",
  };
}

export function emptyOper(): InterfaceOper {
  return { trunk: false, bundled: false, stp: new Map(), neighbor: null, nativeMismatch: false };
}

export function newInterface(
  dev: { kind: IosDeviceKind; baseMac: string },
  type: InterfaceType,
  number: string,
  index: number,
): InterfaceState {
  const switched = dev.kind !== "router" && (type === "FastEthernet" || type === "GigabitEthernet" || type === "Port-channel");
  const virtual = type === "Vlan" || type === "Loopback" || type === "Port-channel";
  return {
    name: `${type}${number}`,
    type,
    number,
    mac: deriveMac(dev.baseMac, CISCO_OUI, index),
    // Switch ports ship enabled, router ports ship shut down (as on real IOS).
    adminUp: dev.kind !== "router" || virtual,
    carrier: false,
    errDisabled: null,
    speed: "auto",
    duplex: "auto",
    helperAddresses: [],
    switchport: switched ? defaultSwitchport(dev.kind) : null,
    portSecurity: {
      enabled: false,
      maximum: 1,
      violation: "shutdown",
      sticky: false,
      staticMacs: [],
      stickyMacs: [],
      agingMinutes: 0,
      violationCount: 0,
      lastSource: null,
    },
    stp: { portfast: "default", bpduguard: "default", cost: null, portPriority: 128 },
    channelGroup: null,
    cdpEnabled: true,
    dhcpSnoopingTrust: false,
    arpInspectionTrust: false,
    oper: emptyOper(),
  };
}

export function defaultLine(): LineConfig {
  return {
    password: null,
    login: "none",
    transportInput: "all",
    execTimeout: [10, 0],
    loggingSynchronous: false,
    historySize: 10,
    privilegeLevel: null,
  };
}

const MODELS: Record<IosDeviceKind, string> = {
  router: "ISR4331",
  "switch-l2": "WS-C2960-24TT-L",
  "switch-l3": "WS-C3560-24PS",
};

export function createDevice(kind: IosDeviceKind, hostname?: string, seed?: string): DeviceState {
  const name = hostname ?? (kind === "router" ? "Router" : "Switch");
  const baseMac = deriveMac(`${seed ?? name}:${kind}`, CISCO_OUI);
  const dev: DeviceState = {
    kind,
    hostname: name,
    model: MODELS[kind],
    baseMac,
    interfaces: [],
    vlans: new Map(),
    staticRoutes: [],
    macTable: [],
    macAgingTime: 300,
    startupConfig: null,
    vlanDat: kind !== "router",
    enableSecret: null,
    enablePassword: null,
    servicePasswordEncryption: false,
    banners: {},
    users: new Map(),
    domainName: null,
    domainLookup: true,
    nameServers: [],
    defaultGateway: null,
    ipRouting: kind !== "switch-l2",
    ssh: { version: null, timeout: 120, retries: 3, rsaBits: null },
    // vty lines default to "login" (password required), the console does not.
    lines: { console: defaultLine(), vty: Array.from({ length: 16 }, () => ({ ...defaultLine(), login: "line" as const })) },
    stp: { mode: "pvst", priorities: new Map(), portfastDefault: false, bpduguardDefault: false, root: new Map() },
    vtp: { mode: kind === "router" ? "off" : "server", domain: "", password: null, version: 1, revision: 0, pruning: false },
    cdpRun: true,
    lldpRun: false,
    dhcpSnooping: { enabled: false, vlans: [] },
    arpInspectionVlans: [],
    errdisableRecovery: { causes: [], interval: 300 },
    ntpServers: [],
    loggingHosts: [],
    clockOffsetMs: 0,
    terminal: { length: 24, width: 80, monitor: false },
  };
  const add = (type: InterfaceType, number: string) =>
    dev.interfaces.push(newInterface(dev, type, number, dev.interfaces.length + 1));
  if (kind === "router") {
    for (let i = 0; i < 3; i++) add("GigabitEthernet", `0/0/${i}`);
  } else {
    for (let i = 1; i <= 24; i++) add("FastEthernet", `0/${i}`);
    for (let i = 1; i <= 2; i++) add("GigabitEthernet", `0/${i}`);
    add("Vlan", "1");
    dev.interfaces.at(-1)!.adminUp = false;
    dev.vlans.set(1, { id: 1, name: "default" });
  }
  return dev;
}

/** Adds a virtual interface (Vlan, Loopback, Port-channel) in IOS order. */
export function addVirtualInterface(dev: DeviceState, type: InterfaceType, number: string): InterfaceState {
  const iface = newInterface(dev, type, number, 100 + dev.interfaces.length);
  if (type === "Vlan") iface.mac = dev.baseMac;
  const order: InterfaceType[] = ["Port-channel", "FastEthernet", "GigabitEthernet", "Loopback", "Vlan"];
  const rank = (i: InterfaceState) => order.indexOf(i.type) * 1e6 + Number(i.number.split("/").at(-1));
  const pos = dev.interfaces.findIndex((i) => rank(i) > rank(iface));
  if (pos === -1) dev.interfaces.push(iface);
  else dev.interfaces.splice(pos, 0, iface);
  return iface;
}

export function shortInterfaceName(i: InterfaceState): string {
  return `${INTERFACE_TYPES[i.type].abbrev}${i.number}`;
}

/** Resolve "g0/1", "Gi0/1", "gigabitethernet0/1", "vlan10", "po1"... */
export function parseInterfaceName(raw: string): { type: InterfaceType; number: string } | null {
  const m = /^([a-z-]+)\s*(\d+(?:\/\d+)*)$/i.exec(raw.trim());
  if (!m) return null;
  const prefix = m[1]!.toLowerCase();
  const matches = (Object.keys(INTERFACE_TYPES) as InterfaceType[]).filter((t) => t.toLowerCase().startsWith(prefix));
  if (matches.length !== 1) return null;
  return { type: matches[0]!, number: m[2]! };
}

export function findInterface(dev: DeviceState, name: string): InterfaceState | undefined {
  const exact = dev.interfaces.find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const parsed = parseInterfaceName(name);
  return parsed ? dev.interfaces.find((i) => i.type === parsed.type && i.number === parsed.number) : undefined;
}

export function isVirtual(i: InterfaceState): boolean {
  return i.type === "Vlan" || i.type === "Loopback";
}

export function isPhysical(i: InterfaceState): boolean {
  return i.type === "FastEthernet" || i.type === "GigabitEthernet";
}

export function isSwitch(dev: DeviceState): boolean {
  return dev.kind !== "router";
}

/** Ethernet channel members, for a port-channel interface. */
export function channelMembers(dev: DeviceState, po: InterfaceState): InterfaceState[] {
  return dev.interfaces.filter((i) => i.channelGroup?.id === Number(po.number));
}

export function allowedVlans(sp: SwitchportConfig): number[] | "all" {
  return sp.allowedVlans;
}

/** Operational switchport mode: "trunk", "access", or null (routed / down). */
export function operMode(i: InterfaceState): "trunk" | "access" | null {
  if (!i.switchport) return null;
  return i.oper.trunk ? "trunk" : "access";
}

/** True if this (logical) port carries `vlan` in its current mode. */
export function carriesVlan(i: InterfaceState, vlan: number): boolean {
  const sp = i.switchport;
  if (!sp) return false;
  if (i.oper.trunk) return sp.allowedVlans === "all" || sp.allowedVlans.includes(vlan);
  return sp.accessVlan === vlan || sp.voiceVlan === vlan;
}

export interface LinkStatus {
  status: "up" | "down" | "administratively down";
  protocol: "up" | "down";
}

/** Line status as displayed by `show ip interface brief`. */
export function interfaceStatus(dev: DeviceState, i: InterfaceState): LinkStatus {
  if (!i.adminUp) return { status: "administratively down", protocol: "down" };
  if (i.errDisabled) return { status: "down", protocol: "down" };
  switch (i.type) {
    case "Loopback":
      return { status: "up", protocol: "up" };
    case "Port-channel": {
      const up = channelMembers(dev, i).some((m) => m.oper.bundled && interfaceStatus(dev, m).protocol === "up");
      return up ? { status: "up", protocol: "up" } : { status: "down", protocol: "down" };
    }
    case "Vlan": {
      // An SVI is up when at least one port forwarding in its VLAN is up.
      const vid = Number(i.number);
      const up =
        dev.vlans.has(vid) &&
        dev.interfaces.some((p) => {
          if (isVirtual(p) || (p.channelGroup && p.type !== "Port-channel") || !carriesVlan(p, vid)) return false;
          if (p.type !== "Port-channel" && !p.carrier) return false;
          if (p.type === "Port-channel" && interfaceStatus(dev, p).protocol !== "up") return false;
          if (!p.adminUp || p.errDisabled) return false;
          const stp = p.oper.stp.get(vid);
          return !stp || stp.forwarding;
        });
      return up ? { status: "up", protocol: "up" } : { status: "down", protocol: "down" };
    }
    default:
      return i.carrier ? { status: "up", protocol: "up" } : { status: "down", protocol: "down" };
  }
}

/** Nominal bandwidth in Mb/s. */
export function bandwidthMbps(dev: DeviceState, i: InterfaceState): number {
  if (i.speed !== "auto") return Number(i.speed);
  if (i.type === "FastEthernet") return 100;
  if (i.type === "Port-channel") {
    return channelMembers(dev, i)
      .filter((m) => m.oper.bundled)
      .reduce((sum, m) => sum + bandwidthMbps(dev, m), 0) || 100;
  }
  return 1000;
}
