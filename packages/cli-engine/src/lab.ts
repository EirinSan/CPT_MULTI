/**
 * A lab = several devices wired by a topology. After every command the lab
 * recomputes the physical layer (carrier = cable plugged and far end
 * administratively up) and the L2 control plane (see l2.ts), then turns the
 * resulting state changes into syslog messages on each console.
 */
import type { DeviceKind, Topology, TopologyDevice } from "@cpt/shared";
import { createDevice, findInterface, type LinkStatus } from "./device";
import { computeL2, type L2Link, type L2Node } from "./l2";
import { deriveMac } from "./net";
import { CliSession } from "./session";
import type { DeviceState, InterfaceState, IosDeviceKind } from "./types";

export interface LabNode {
  id: string;
  kind: DeviceKind;
  spec: TopologyDevice;
  /** null for hosts (PC / server), which have no IOS console. */
  session: CliSession | null;
  /** NIC address for hosts. */
  hostMac: string | null;
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

export { findInterface };

export class Lab {
  readonly nodes = new Map<string, LabNode>();
  private readonly links: L2Link[];

  constructor(readonly topology: Topology) {
    for (const spec of topology.devices) {
      let session: CliSession | null = null;
      if (isIosKind(spec.kind)) {
        session = new CliSession(createDevice(spec.kind, spec.hostname, spec.id), { seed: spec.id });
        session.attachedToLab = true;
      }
      const hostMac = session ? null : deriveMac(spec.id, [0x00, 0xe0, 0xf7]);
      this.nodes.set(spec.id, { id: spec.id, kind: spec.kind, spec, session, hostMac });
    }
    this.links = topology.links.map((l) => ({
      a: { nodeId: l.a.deviceId, ifName: l.a.interface },
      b: { nodeId: l.b.deviceId, ifName: l.b.interface },
    }));
    for (const node of this.nodes.values()) {
      if (node.session && node.spec.startupConfig?.length) node.session.loadConfig(node.spec.startupConfig);
    }
    this.refresh();
  }

  session(deviceId: string): CliSession {
    const s = this.nodes.get(deviceId)?.session;
    if (!s) throw new Error(`No console on device ${deviceId}`);
    return s;
  }

  device(deviceId: string): DeviceState | undefined {
    return this.nodes.get(deviceId)?.session?.device;
  }

  /** Run a CLI line on a device, then propagate link / L2 state changes. */
  execute(deviceId: string, line: string): LabExecResult {
    const output = this.session(deviceId).execute(line);
    const before = new Map<string, Map<InterfaceState, LinkStatus>>();
    for (const n of this.nodes.values()) if (n.session) before.set(n.id, n.session.snapshotStatuses());

    const events = this.refresh();
    const syslog = new Map<string, string[]>();
    for (const n of this.nodes.values()) {
      if (!n.session) continue;
      const changes = n.session.statusChanges(before.get(n.id)!).filter((l) => l !== "");
      const lines = [...(events.get(n.id) ?? []), ...changes];
      if (lines.length) syslog.set(n.id, ["", ...lines]);
    }
    const own = syslog.get(deviceId);
    if (own) {
      output.push(...own);
      syslog.delete(deviceId);
    }
    return { output, syslog };
  }

  /** True when both ends of the link are up. */
  linkUp(linkId: string): boolean {
    const link = this.topology.links.find((l) => l.id === linkId);
    if (!link) return false;
    return [link.a, link.b].every((end) => {
      const dev = this.device(end.deviceId);
      if (!this.nodes.has(end.deviceId)) return false;
      if (!dev) return true;
      const i = findInterface(dev, end.interface);
      return !!i && i.adminUp && !i.errDisabled && i.carrier;
    });
  }

  /** Physical layer + L2 convergence. Returns event syslog per device. */
  private refresh(): Map<string, string[]> {
    const events = new Map<string, string[]>();
    const l2nodes = new Map<string, L2Node>();
    for (const n of this.nodes.values()) {
      l2nodes.set(n.id, { id: n.id, kind: n.kind, device: n.session?.device ?? null, hostMac: n.hostMac });
    }
    // Err-disabling a port drops the far end's carrier: iterate to a fixpoint.
    for (let round = 0; round < 4; round++) {
      this.refreshCarriers();
      const disabledBefore = this.countErrDisabled();
      for (const [id, lines] of computeL2(l2nodes, this.links)) events.set(id, [...(events.get(id) ?? []), ...lines]);
      if (this.countErrDisabled() === disabledBefore) break;
    }
    return events;
  }

  private countErrDisabled(): number {
    let n = 0;
    for (const node of this.nodes.values()) for (const i of node.session?.device.interfaces ?? []) if (i.errDisabled) n++;
    return n;
  }

  private refreshCarriers(): void {
    const peerUp = (deviceId: string, ifName: string): boolean => {
      const node = this.nodes.get(deviceId);
      if (!node) return false;
      if (!node.session) return true; // hosts are always powered on
      const i = findInterface(node.session.device, ifName);
      return !!i && i.adminUp && !i.errDisabled;
    };
    const cabled = new Set<InterfaceState>();
    for (const l of this.links) {
      for (const [self, peer] of [
        [l.a, l.b],
        [l.b, l.a],
      ] as const) {
        const dev = this.device(self.nodeId);
        const iface = dev && findInterface(dev, self.ifName);
        if (!iface) continue;
        cabled.add(iface);
        iface.carrier = peerUp(peer.nodeId, peer.ifName);
      }
    }
    for (const n of this.nodes.values()) {
      for (const i of n.session?.device.interfaces ?? []) if (!cabled.has(i)) i.carrier = false;
    }
  }
}
