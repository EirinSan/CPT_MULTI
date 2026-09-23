export type CliMode = "user" | "privileged" | "config" | "config-if" | "config-vlan";

export type IosDeviceKind = "switch-l2" | "switch-l3" | "router";

export type InterfaceType = "FastEthernet" | "GigabitEthernet" | "Vlan" | "Loopback";

export interface Ipv4Config {
  address: string;
  mask: string;
}

export interface SwitchportConfig {
  mode: "access" | "trunk";
  accessVlan: number;
}

export interface InterfaceState {
  /** Canonical full name, e.g. "GigabitEthernet0/1". */
  name: string;
  type: InterfaceType;
  /** "0/1", "10", ... */
  number: string;
  description?: string;
  /** `shutdown` / `no shutdown`. */
  adminUp: boolean;
  /**
   * Physical link state, owned by the simulation engine (cable plugged and
   * peer interface up). Virtual interfaces ignore it.
   */
  carrier: boolean;
  ipv4?: Ipv4Config;
  /** null = routed port (`no switchport`) or router interface. */
  switchport: SwitchportConfig | null;
}

export interface VlanState {
  id: number;
  name: string;
}

export interface StaticRoute {
  network: string;
  mask: string;
  nextHop: string;
}

export interface MacEntry {
  vlan: number;
  mac: string; // "0001.4a2b.3c4d"
  type: "DYNAMIC" | "STATIC";
  port: string;
}

export interface DeviceState {
  kind: IosDeviceKind;
  hostname: string;
  model: string;
  interfaces: InterfaceState[];
  vlans: Map<number, VlanState>;
  staticRoutes: StaticRoute[];
  /** Learned by the simulation engine, read-only from the CLI. */
  macTable: MacEntry[];
  /** Saved by `write memory`; null until the first save. */
  startupConfig: string[] | null;
}
