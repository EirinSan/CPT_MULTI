export type CliMode =
  | "user"
  | "privileged"
  | "config"
  | "config-if"
  | "config-if-range"
  | "config-vlan"
  | "config-line";

export type IosDeviceKind = "switch-l2" | "switch-l3" | "router";

export type InterfaceType = "FastEthernet" | "GigabitEthernet" | "Vlan" | "Loopback" | "Port-channel";

export interface Ipv4Config {
  address: string;
  mask: string;
}

/** `switchport mode ...` (administrative mode). */
export type SwitchportMode = "access" | "trunk" | "dynamic-auto" | "dynamic-desirable";

export interface SwitchportConfig {
  mode: SwitchportMode;
  accessVlan: number;
  voiceVlan: number | null;
  nativeVlan: number;
  /** "all" or an explicit sorted list. */
  allowedVlans: "all" | number[];
  nonegotiate: boolean;
  /** L3 switches only: `switchport trunk encapsulation`. */
  encapsulation: "dot1q" | "isl" | "negotiate";
}

export type PortSecurityViolation = "protect" | "restrict" | "shutdown";

export interface PortSecurityConfig {
  enabled: boolean;
  maximum: number;
  violation: PortSecurityViolation;
  sticky: boolean;
  staticMacs: string[];
  stickyMacs: string[];
  agingMinutes: number;
  violationCount: number;
  lastSource: string | null;
}

export type ChannelMode = "active" | "passive" | "on" | "desirable" | "auto";

export interface StpPortConfig {
  portfast: "default" | "enable" | "trunk" | "disable";
  bpduguard: "default" | "enable" | "disable";
  cost: number | null;
  portPriority: number;
}

export type StpRole = "Root" | "Desg" | "Altn" | "Back";

/** Operational state, computed by the lab (never configured directly). */
export interface InterfaceOper {
  /** DTP result: true when the port is operationally trunking. */
  trunk: boolean;
  /** EtherChannel member bundled in its port-channel. */
  bundled: boolean;
  /** STP role/state per VLAN for ports that run spanning tree. */
  stp: Map<number, { role: StpRole; forwarding: boolean; cost: number }>;
  /** CDP neighbor seen on this port. */
  neighbor: CdpNeighbor | null;
  nativeMismatch: boolean;
}

export interface CdpNeighbor {
  deviceId: string;
  platform: string;
  capabilities: string;
  portId: string;
  ipAddress: string | null;
  nativeVlan: number | null;
  version: string;
}

export interface InterfaceState {
  /** Canonical full name, e.g. "GigabitEthernet0/1". */
  name: string;
  type: InterfaceType;
  /** "0/1", "10", ... */
  number: string;
  /** Hardware address. */
  mac: string;
  description?: string;
  /** `shutdown` / `no shutdown`. */
  adminUp: boolean;
  /**
   * Physical link state, owned by the lab (cable plugged and peer interface
   * up). Virtual interfaces ignore it.
   */
  carrier: boolean;
  /** Set by BPDU guard / port-security; cleared by shutdown. */
  errDisabled: "bpduguard" | "psecure-violation" | null;
  speed: "auto" | "10" | "100" | "1000";
  duplex: "auto" | "full" | "half";
  ipv4?: Ipv4Config;
  helperAddresses: string[];
  /** null = routed port (`no switchport`) or router interface. */
  switchport: SwitchportConfig | null;
  portSecurity: PortSecurityConfig;
  stp: StpPortConfig;
  channelGroup: { id: number; mode: ChannelMode } | null;
  cdpEnabled: boolean;
  dhcpSnoopingTrust: boolean;
  arpInspectionTrust: boolean;
  oper: InterfaceOper;
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

/** Secret stored as a salted hash ("enable secret", "username ... secret"). */
export interface SecretHash {
  salt: string;
  hash: string;
}

export interface LineConfig {
  /** Plain text; shown as type 7 when service password-encryption is on. */
  password: string | null;
  login: "none" | "line" | "local";
  transportInput: Array<"ssh" | "telnet"> | "all" | "none";
  execTimeout: [number, number];
  loggingSynchronous: boolean;
  historySize: number;
  privilegeLevel: number | null;
}

export interface LocalUser {
  privilege: number;
  secret?: SecretHash;
  password?: string;
}

export type VtpMode = "server" | "client" | "transparent" | "off";

export interface DeviceState {
  kind: IosDeviceKind;
  hostname: string;
  model: string;
  baseMac: string;
  interfaces: InterfaceState[];
  vlans: Map<number, VlanState>;
  staticRoutes: StaticRoute[];
  /** Static entries configured + dynamic entries learned by the lab. */
  macTable: MacEntry[];
  macAgingTime: number;
  /** Saved by `write memory`; null until the first save (NVRAM). */
  startupConfig: string[] | null;
  /** vlan.dat present in flash (VLANs survive reload unless deleted). */
  vlanDat: boolean;

  enableSecret: SecretHash | null;
  enablePassword: string | null;
  servicePasswordEncryption: boolean;
  banners: { motd?: string; login?: string; exec?: string };
  users: Map<string, LocalUser>;

  domainName: string | null;
  domainLookup: boolean;
  nameServers: string[];
  defaultGateway: string | null;
  ipRouting: boolean;
  ssh: { version: 1 | 2 | null; timeout: number; retries: number; rsaBits: number | null };

  lines: { console: LineConfig; vty: LineConfig[] };

  stp: {
    mode: "pvst" | "rapid-pvst" | "mst";
    priorities: Map<number, number>;
    portfastDefault: boolean;
    bpduguardDefault: boolean;
    /** Computed: root bridge per VLAN. */
    root: Map<number, { priority: number; mac: string; cost: number; port: string | null }>;
  };
  vtp: { mode: VtpMode; domain: string; password: string | null; version: 1 | 2 | 3; revision: number; pruning: boolean };
  cdpRun: boolean;
  lldpRun: boolean;
  dhcpSnooping: { enabled: boolean; vlans: number[] };
  arpInspectionVlans: number[];
  errdisableRecovery: { causes: string[]; interval: number };
  ntpServers: string[];
  loggingHosts: string[];
  clockOffsetMs: number;
  terminal: { length: number; width: number; monitor: boolean };
}
