/**
 * Serializable topology description. This is the shape stored in
 * `Challenge.initialTopology` and exchanged between client, server and the
 * simulation engine.
 */

export type DeviceKind = "switch-l2" | "switch-l3" | "router" | "pc" | "server";

export type CableKind = "copper-straight" | "copper-crossover" | "fiber";

export interface TopologyDevice {
  /** Stable id used by links and assertions (e.g. "R1", "SW1", "PC1"). */
  id: string;
  kind: DeviceKind;
  hostname: string;
  /** Canvas position, purely visual. */
  position: { x: number; y: number };
  /** Optional startup configuration, as IOS CLI lines. */
  startupConfig?: string[];
  /** Host-only settings (PC / server). */
  host?: {
    ipv4?: string;
    mask?: string;
    gateway?: string;
    dhcp?: boolean;
    services?: Array<"dhcp" | "dns" | "http">;
  };
}

export interface LinkEndpoint {
  deviceId: string;
  /** Full interface name, e.g. "GigabitEthernet0/1". */
  interface: string;
}

export interface TopologyLink {
  id: string;
  cable: CableKind;
  a: LinkEndpoint;
  b: LinkEndpoint;
}

export interface Topology {
  version: 1;
  devices: TopologyDevice[];
  links: TopologyLink[];
}
