/**
 * A lab = several devices wired by a topology. This is the minimal physical
 * layer the future sim-engine will replace: a port has carrier when it is
 * cabled and the port at the other end is administratively up.
 */
import type { DeviceKind, Topology, TopologyDevice } from "@cpt/shared";
import { createDevice, parseInterfaceName } from "./device";
import { CliSession } from "./session";
import type { DeviceState, InterfaceState, IosDeviceKind } from "./types";

export interface LabNode {
  id: string;
  kind: DeviceKind;
  spec: TopologyDevice;
  /** null for hosts (PC / server), which have no IOS console. */
  session: CliSession | null;
}

export interface LabExecResult {
  /** Output for the console that ran the command (own syslog included). */
  output: string[];
  /** Async syslog lines for the other devices' consoles. */
  syslog: Map<string, string[]>;
}

const IOS_KINDS = new Set<DeviceKind>(["switch-l2", "switch-l3", "router"]);

export function isIosKind(kind: DeviceKind): kind is IosDeviceKind {
  return IOS_KINDS.has(kind);
}

export function findInterface(dev: DeviceState, name: string): InterfaceState | undefined {
  const exact = dev.interfaces.find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const parsed = parseInterfaceName(name);
  return parsed ? dev.interfaces.find((i) => i.type === parsed.type && i.number === parsed.number) : undefined;
}

export class Lab {
  readonly nodes = new Map<string, LabNode>();

  constructor(readonly topology: Topology) {
    for (const spec of topology.devices) {
      const session = isIosKind(spec.kind) ? new CliSession(createDevice(spec.kind, spec.hostname)) : null;
      this.nodes.set(spec.id, { id: spec.id, kind: spec.kind, spec, session });
    }
    for (const node of this.nodes.values()) {
      if (node.session && node.spec.startupConfig?.length) applyStartupConfig(node.session, node.spec.startupConfig);
    }
    this.refreshCarriers();
  }

  session(deviceId: string): CliSession {
    const s = this.nodes.get(deviceId)?.session;
    if (!s) throw new Error(`No console on device ${deviceId}`);
    return s;
  }

  device(deviceId: string): DeviceState | undefined {
    return this.nodes.get(deviceId)?.session?.device;
  }

  /** Run a CLI line on a device, then propagate link state changes. */
  execute(deviceId: string, line: string): LabExecResult {
    const output = this.session(deviceId).execute(line);
    const syslog = this.refreshCarriers();
    const own = syslog.get(deviceId);
    if (own) {
      output.push(...own);
      syslog.delete(deviceId);
    }
    return { output, syslog };
  }

  /** True when both ends of the link have carrier and are admin up. */
  linkUp(linkId: string): boolean {
    const link = this.topology.links.find((l) => l.id === linkId);
    if (!link) return false;
    return [link.a, link.b].every((end) => this.endpointUp(end.deviceId, end.interface));
  }

  private endpointUp(deviceId: string, ifName: string): boolean {
    const node = this.nodes.get(deviceId);
    if (!node) return false;
    if (!node.session) return true;
    const iface = findInterface(node.session.device, ifName);
    return !!iface && iface.adminUp && iface.carrier;
  }

  private peerAdminUp(deviceId: string, ifName: string): boolean {
    const node = this.nodes.get(deviceId);
    if (!node) return false;
    if (!node.session) return true; // hosts are always powered on
    return findInterface(node.session.device, ifName)?.adminUp ?? false;
  }

  /** Recompute carrier on every cabled port; returns syslog per device. */
  private refreshCarriers(): Map<string, string[]> {
    const wanted = new Map<string, Map<string, boolean>>();
    for (const link of this.topology.links) {
      for (const [self, peer] of [
        [link.a, link.b],
        [link.b, link.a],
      ] as const) {
        const dev = this.device(self.deviceId);
        if (!dev) continue;
        const iface = findInterface(dev, self.interface);
        if (!iface) continue;
        let perDevice = wanted.get(self.deviceId);
        if (!perDevice) wanted.set(self.deviceId, (perDevice = new Map()));
        perDevice.set(iface.name, this.peerAdminUp(peer.deviceId, peer.interface));
      }
    }
    const syslog = new Map<string, string[]>();
    for (const [deviceId, ports] of wanted) {
      const session = this.session(deviceId);
      const lines: string[] = [];
      for (const [ifName, carrier] of ports) lines.push(...session.setCarrier(ifName, carrier));
      if (lines.length) syslog.set(deviceId, lines);
    }
    return syslog;
  }
}

function applyStartupConfig(session: CliSession, lines: string[]): void {
  session.execute("enable");
  session.execute("configure terminal");
  for (const line of lines) session.execute(line);
  session.execute("end");
  session.mode = "user";
  session.history.splice(0);
  session.syntaxErrors = 0;
}
