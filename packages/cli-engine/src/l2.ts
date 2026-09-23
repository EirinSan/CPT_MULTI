/**
 * Layer 2 control plane, recomputed from scratch after every command.
 *
 * The lab has no packet engine yet, so protocols are solved "at convergence"
 * instead of being simulated frame by frame: DTP, EtherChannel negotiation,
 * VTP synchronisation, per-VLAN spanning tree (802.1D election), BPDU guard,
 * port-security and MAC learning. Hosts are assumed to be chatty: as soon as
 * their link is up, every switch in their VLAN learns their MAC.
 */
import type { DeviceKind } from "@cpt/shared";
import {
  bandwidthMbps,
  carriesVlan,
  channelMembers,
  emptyOper,
  findInterface,
  interfaceStatus,
  isPhysical,
  isSwitch,
  shortInterfaceName,
} from "./device";
import type { CdpNeighbor, DeviceState, InterfaceState, SwitchportConfig } from "./types";

export interface L2Node {
  id: string;
  kind: DeviceKind;
  /** null for hosts. */
  device: DeviceState | null;
  /** Host NIC address (PC / server). */
  hostMac: string | null;
}

export interface L2Link {
  a: { nodeId: string; ifName: string };
  b: { nodeId: string; ifName: string };
}

interface End {
  node: L2Node;
  iface: InterfaceState | null;
}

interface ResolvedLink {
  a: End;
  b: End;
}

type Events = Map<string, string[]>;

function emit(events: Events, nodeId: string, ...lines: string[]): void {
  const list = events.get(nodeId) ?? [];
  list.push(...lines);
  events.set(nodeId, list);
}

/** Physical port usable: admin up, not err-disabled, carrier present. */
export function portUp(i: InterfaceState): boolean {
  return i.adminUp && !i.errDisabled && i.carrier;
}

function linkUp(l: ResolvedLink): boolean {
  const up = (e: End) => (e.iface ? portUp(e.iface) : true);
  return up(l.a) && up(l.b);
}

export function portfastOper(dev: DeviceState, i: InterfaceState): boolean {
  if (i.stp.portfast === "disable") return false;
  if (i.stp.portfast === "trunk") return true;
  if (i.oper.trunk) return false;
  return i.stp.portfast === "enable" || dev.stp.portfastDefault;
}

function bpduguardOper(dev: DeviceState, i: InterfaceState): boolean {
  if (i.stp.bpduguard === "enable") return true;
  if (i.stp.bpduguard === "disable") return false;
  return dev.stp.bpduguardDefault && portfastOper(dev, i);
}

// ---------------------------------------------------------------------------
// DTP
// ---------------------------------------------------------------------------

function dtpTrunk(self: SwitchportConfig, peer: SwitchportConfig | null): boolean {
  switch (self.mode) {
    case "trunk":
      return true;
    case "access":
      return false;
    case "dynamic-desirable":
      return !!peer && ((peer.mode === "trunk" && !peer.nonegotiate) || peer.mode === "dynamic-desirable" || peer.mode === "dynamic-auto");
    case "dynamic-auto":
      return !!peer && ((peer.mode === "trunk" && !peer.nonegotiate) || peer.mode === "dynamic-desirable");
  }
}

// ---------------------------------------------------------------------------
// EtherChannel
// ---------------------------------------------------------------------------

function channelCompatible(a: InterfaceState, b: InterfaceState): boolean {
  const ma = a.channelGroup?.mode;
  const mb = b.channelGroup?.mode;
  if (!ma || !mb) return false;
  if (ma === "on" || mb === "on") return ma === mb;
  const lacp = (m: string) => m === "active" || m === "passive";
  if (lacp(ma) !== lacp(mb)) return false;
  // passive/passive and auto/auto never negotiate.
  return !((ma === "passive" && mb === "passive") || (ma === "auto" && mb === "auto"));
}

function portChannelOf(dev: DeviceState, i: InterfaceState): InterfaceState | undefined {
  if (!i.channelGroup || !i.oper.bundled) return undefined;
  return dev.interfaces.find((p) => p.type === "Port-channel" && Number(p.number) === i.channelGroup!.id);
}

/** STP / VLAN view of a physical port: its port-channel when bundled. */
function logical(dev: DeviceState, i: InterfaceState): InterfaceState {
  return portChannelOf(dev, i) ?? i;
}

// ---------------------------------------------------------------------------
// STP helpers
// ---------------------------------------------------------------------------

interface BridgeId {
  priority: number;
  mac: string;
}

function cmpBridge(a: BridgeId, b: BridgeId): number {
  return a.priority - b.priority || (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0);
}

export function stpCost(dev: DeviceState, i: InterfaceState): number {
  if (i.stp.cost !== null) return i.stp.cost;
  const bw = bandwidthMbps(dev, i);
  if (bw >= 10000) return 2;
  if (bw >= 2000) return 3;
  if (bw >= 1000) return 4;
  if (bw >= 400) return 8;
  if (bw >= 300) return 9;
  if (bw >= 200) return 12;
  if (bw >= 100) return 19;
  return 100;
}

export function stpPortNumber(dev: DeviceState, i: InterfaceState): number {
  if (i.type === "Port-channel") return 64 + Number(i.number);
  return dev.interfaces.filter(isPhysical).indexOf(i) + 1;
}

function portId(dev: DeviceState, i: InterfaceState): number {
  return i.stp.portPriority * 1000 + stpPortNumber(dev, i);
}

export function bridgeId(dev: DeviceState, vlan: number): BridgeId {
  return { priority: (dev.stp.priorities.get(vlan) ?? 32768) + vlan, mac: dev.baseMac };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeL2(nodes: Map<string, L2Node>, links: L2Link[]): Events {
  const events: Events = new Map();
  const devices = [...nodes.values()].filter((n) => n.device) as Array<L2Node & { device: DeviceState }>;

  const resolved: ResolvedLink[] = [];
  for (const l of links) {
    const a = nodes.get(l.a.nodeId);
    const b = nodes.get(l.b.nodeId);
    if (!a || !b) continue;
    const ia = a.device ? (findInterface(a.device, l.a.ifName) ?? null) : null;
    const ib = b.device ? (findInterface(b.device, l.b.ifName) ?? null) : null;
    if ((a.device && !ia) || (b.device && !ib)) continue;
    resolved.push({ a: { node: a, iface: ia }, b: { node: b, iface: ib } });
  }
  const sides = (l: ResolvedLink): Array<[End, End]> => [
    [l.a, l.b],
    [l.b, l.a],
  ];

  // Reset operational state.
  const previousMismatch = new Set<InterfaceState>();
  for (const { device } of devices) {
    for (const i of device.interfaces) {
      if (i.oper.nativeMismatch) previousMismatch.add(i);
      i.oper = emptyOper();
    }
  }

  // 1. EtherChannel bundling.
  for (const l of resolved) {
    const { a, b } = l;
    if (a.iface && b.iface && linkUp(l) && channelCompatible(a.iface, b.iface)) {
      a.iface.oper.bundled = true;
      b.iface.oper.bundled = true;
    }
  }

  // 2. DTP (on the logical port: port-channel settings win for members).
  const peerOf = new Map<InterfaceState, End>();
  for (const l of resolved) for (const [self, peer] of sides(l)) if (self.iface) peerOf.set(self.iface, peer);
  for (const { device } of devices) {
    for (const i of device.interfaces) {
      if (!i.switchport) continue;
      if (i.type === "Port-channel") {
        const member = channelMembers(device, i).find((m) => m.oper.bundled);
        const peerEnd = member ? peerOf.get(member) : undefined;
        const peerPo = peerEnd?.iface && peerEnd.node.device ? portChannelOf(peerEnd.node.device, peerEnd.iface) : undefined;
        i.oper.trunk = member ? dtpTrunk(i.switchport, peerPo?.switchport ?? null) : i.switchport.mode === "trunk";
        for (const m of channelMembers(device, i)) if (m.oper.bundled) m.oper.trunk = i.oper.trunk;
        continue;
      }
      if (i.oper.bundled) continue;
      const peer = peerOf.get(i);
      const up = peer && portUp(i) && (!peer.iface || portUp(peer.iface));
      i.oper.trunk = up ? dtpTrunk(i.switchport, peer.iface?.switchport ?? null) : i.switchport.mode === "trunk";
    }
  }

  // 3. BPDU guard and port-security (may err-disable ports).
  for (const l of resolved) {
    if (!linkUp(l)) continue;
    for (const [self, peer] of sides(l)) {
      const dev = self.node.device;
      const i = self.iface;
      if (!dev || !i || !i.switchport || !isSwitch(dev)) continue;
      const peerSendsBpdu = !!peer.node.device && isSwitch(peer.node.device) && !!peer.iface?.switchport;
      if (peerSendsBpdu && bpduguardOper(dev, i)) {
        i.errDisabled = "bpduguard";
        const s = shortInterfaceName(i);
        emit(
          events,
          self.node.id,
          `%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${i.name} with BPDU Guard enabled. Disabling port.`,
          `%PM-4-ERR_DISABLE: bpduguard error detected on ${s}, putting ${s} in err-disable state`,
        );
        continue;
      }
      const ps = i.portSecurity;
      const srcMac = peer.node.hostMac ?? (peer.iface && !peer.iface.switchport ? peer.iface.mac : null);
      if (!ps.enabled || i.oper.trunk || !srcMac) continue;
      const known = [...ps.staticMacs, ...ps.stickyMacs];
      if (known.includes(srcMac)) continue;
      if (known.length < ps.maximum) {
        if (ps.sticky) ps.stickyMacs.push(srcMac);
        continue;
      }
      // Violation.
      if (ps.lastSource !== srcMac || ps.violation === "shutdown") ps.violationCount++;
      const first = ps.lastSource !== srcMac;
      ps.lastSource = srcMac;
      const violationLine = `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${srcMac} on port ${i.name}.`;
      if (ps.violation === "shutdown") {
        i.errDisabled = "psecure-violation";
        const s = shortInterfaceName(i);
        emit(events, self.node.id, `%PM-4-ERR_DISABLE: psecure-violation error detected on ${s}, putting ${s} in err-disable state`, violationLine);
      } else if (ps.violation === "restrict" && first) {
        emit(events, self.node.id, violationLine);
      }
    }
  }

  // 4. CDP + native VLAN mismatch.
  for (const l of resolved) {
    if (!linkUp(l)) continue;
    for (const [self, peer] of sides(l)) {
      const dev = self.node.device;
      const pdev = peer.node.device;
      if (!dev || !pdev || !self.iface || !peer.iface) continue;
      if (!dev.cdpRun || !pdev.cdpRun || !self.iface.cdpEnabled || !peer.iface.cdpEnabled) continue;
      self.iface.oper.neighbor = cdpInfo(pdev, peer.iface);
      const sp = self.iface.switchport;
      const pp = peer.iface.switchport;
      if (sp && pp && self.iface.oper.trunk && peer.iface.oper.trunk && sp.nativeVlan !== pp.nativeVlan) {
        self.iface.oper.nativeMismatch = true;
        if (!previousMismatch.has(self.iface)) {
          emit(
            events,
            self.node.id,
            `%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${self.iface.name} (${sp.nativeVlan}), with ${pdev.hostname} ${peer.iface.name} (${pp.nativeVlan}).`,
          );
        }
      }
    }
  }

  // Switch adjacency over trunks (logical ports), used by VTP.
  const switches = devices.filter((d) => isSwitch(d.device));
  const trunkNeighbors = new Map<DeviceState, DeviceState[]>();
  for (const l of resolved) {
    const da = l.a.node.device;
    const db = l.b.node.device;
    if (!da || !db || !isSwitch(da) || !isSwitch(db) || !linkUp(l)) continue;
    if (!l.a.iface!.oper.trunk || !l.b.iface!.oper.trunk) continue;
    trunkNeighbors.set(da, [...(trunkNeighbors.get(da) ?? []), db]);
    trunkNeighbors.set(db, [...(trunkNeighbors.get(db) ?? []), da]);
  }

  // 5. VTP.
  syncVtp(switches.map((s) => s.device), trunkNeighbors);

  // 6. Spanning tree, per VLAN.
  const allVlans = new Set<number>();
  for (const s of switches) for (const v of s.device.vlans.keys()) if (v < 1002 || v > 1005) allVlans.add(v);
  for (const s of switches) s.device.stp.root.clear();
  for (const v of [...allVlans].sort((x, y) => x - y)) runStp(v, switches, resolved);

  // 7. MAC learning.
  learnMacs(switches, resolved);

  return events;
}

function cdpInfo(dev: DeviceState, iface: InterfaceState): CdpNeighbor {
  const mgmt = dev.interfaces.find((i) => i.ipv4 && interfaceStatus(dev, i).protocol === "up");
  const caps = dev.kind === "router" ? "R B S I" : dev.kind === "switch-l3" ? "R S I" : "S I";
  return {
    deviceId: dev.domainName ? `${dev.hostname}.${dev.domainName}` : dev.hostname,
    platform: dev.model,
    capabilities: caps,
    portId: iface.name,
    ipAddress: mgmt?.ipv4?.address ?? null,
    nativeVlan: iface.switchport ? iface.switchport.nativeVlan : null,
    version: dev.kind === "router" ? "Version 16.9.4" : "Version 15.0(2)SE4",
  };
}

// ---------------------------------------------------------------------------
// VTP
// ---------------------------------------------------------------------------

function syncVtp(switches: DeviceState[], neighbors: Map<DeviceState, DeviceState[]>): void {
  const seen = new Set<DeviceState>();
  for (const start of switches) {
    if (seen.has(start)) continue;
    // Connected component over trunks (transparent switches relay adverts).
    const component: DeviceState[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const d = queue.shift()!;
      component.push(d);
      for (const n of neighbors.get(d) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    const members = component.filter((d) => d.vtp.mode === "server" || d.vtp.mode === "client");
    // A switch with no domain adopts the first domain it hears.
    const named = members.find((d) => d.vtp.domain !== "");
    if (named) for (const d of members) if (d.vtp.domain === "") d.vtp.domain = named.vtp.domain;
    const groups = new Map<string, DeviceState[]>();
    for (const d of members) {
      if (d.vtp.domain === "") continue;
      const key = `${d.vtp.domain}\u0000${d.vtp.password ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    for (const group of groups.values()) {
      const winner = group.reduce((best, d) => (d.vtp.revision > best.vtp.revision ? d : best));
      for (const d of group) {
        if (d === winner || d.vtp.revision >= winner.vtp.revision) continue;
        for (const id of [...d.vlans.keys()]) if (id > 1 && id < 1002) d.vlans.delete(id);
        for (const [id, v] of winner.vlans) if (id > 1 && id < 1002) d.vlans.set(id, { ...v });
        d.vtp.revision = winner.vtp.revision;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// STP
// ---------------------------------------------------------------------------

interface StpPort {
  dev: DeviceState;
  iface: InterfaceState;
  /** Neighbour switch port carrying the same VLAN, if any. */
  peer: { dev: DeviceState; iface: InterfaceState } | null;
}

interface Vector {
  root: BridgeId;
  cost: number;
  sender: BridgeId;
  senderPort: number;
  localPort: number;
  port: InterfaceState | null;
}

function cmpVector(a: Vector, b: Vector): number {
  return (
    cmpBridge(a.root, b.root) ||
    a.cost - b.cost ||
    cmpBridge(a.sender, b.sender) ||
    a.senderPort - b.senderPort ||
    a.localPort - b.localPort
  );
}

function logicalUp(dev: DeviceState, i: InterfaceState): boolean {
  return i.type === "Port-channel" ? interfaceStatus(dev, i).protocol === "up" : portUp(i);
}

function runStp(vlan: number, switches: Array<L2Node & { device: DeviceState }>, links: ResolvedLink[]): void {
  const participants = switches.map((s) => s.device).filter((d) => d.vlans.has(vlan));
  if (participants.length === 0) return;

  // Logical ports carrying the VLAN, keyed per device.
  const ports = new Map<DeviceState, Map<InterfaceState, StpPort>>();
  const portFor = (dev: DeviceState, physical: InterfaceState): StpPort | null => {
    const li = logical(dev, physical);
    if (!li.switchport || !logicalUp(dev, li) || !carriesVlan(li, vlan)) return null;
    let map = ports.get(dev);
    if (!map) ports.set(dev, (map = new Map()));
    let p = map.get(li);
    if (!p) map.set(li, (p = { dev, iface: li, peer: null }));
    return p;
  };
  for (const dev of participants) {
    for (const i of dev.interfaces) if (isPhysical(i) && portUp(i)) portFor(dev, i);
  }
  for (const l of links) {
    const da = l.a.node.device;
    const db = l.b.node.device;
    if (!da || !db || !participants.includes(da) || !participants.includes(db) || !linkUp(l)) continue;
    const pa = portFor(da, l.a.iface!);
    const pb = portFor(db, l.b.iface!);
    if (!pa || !pb) continue;
    pa.peer = { dev: db, iface: pb.iface };
    pb.peer = { dev: da, iface: pa.iface };
  }

  const bid = new Map(participants.map((d) => [d, bridgeId(d, vlan)]));
  const self = (d: DeviceState): Vector => ({ root: bid.get(d)!, cost: 0, sender: bid.get(d)!, senderPort: 0, localPort: 0, port: null });
  const best = new Map(participants.map((d) => [d, self(d)]));

  for (let round = 0; round <= participants.length + 1; round++) {
    let changed = false;
    for (const d of participants) {
      let candidate = self(d);
      for (const p of ports.get(d)?.values() ?? []) {
        if (!p.peer) continue;
        const nb = best.get(p.peer.dev)!;
        const v: Vector = {
          root: nb.root,
          cost: nb.cost + stpCost(d, p.iface),
          sender: bid.get(p.peer.dev)!,
          senderPort: portId(p.peer.dev, p.peer.iface),
          localPort: portId(d, p.iface),
          port: p.iface,
        };
        if (cmpVector(v, candidate) < 0) candidate = v;
      }
      if (cmpVector(candidate, best.get(d)!) !== 0) {
        best.set(d, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const d of participants) {
    const b = best.get(d)!;
    d.stp.root.set(vlan, { priority: b.root.priority, mac: b.root.mac, cost: b.cost, port: b.port?.name ?? null });
    for (const p of ports.get(d)?.values() ?? []) {
      const cost = stpCost(d, p.iface);
      let role: "Root" | "Desg" | "Altn" = "Desg";
      if (p.iface === b.port) role = "Root";
      else if (p.peer) {
        const nb = best.get(p.peer.dev)!;
        const mine = [b.root, b.cost, bid.get(d)!, portId(d, p.iface)] as const;
        const theirs = [nb.root, nb.cost, bid.get(p.peer.dev)!, portId(p.peer.dev, p.peer.iface)] as const;
        const cmp =
          cmpBridge(mine[0], theirs[0]) || mine[1] - theirs[1] || cmpBridge(mine[2], theirs[2]) || mine[3] - theirs[3];
        role = cmp < 0 ? "Desg" : "Altn";
      }
      const entry = { role, forwarding: role !== "Altn", cost };
      p.iface.oper.stp.set(vlan, entry);
      if (p.iface.type === "Port-channel") for (const m of channelMembers(d, p.iface)) if (m.oper.bundled) m.oper.stp.set(vlan, entry);
    }
  }
}

// ---------------------------------------------------------------------------
// MAC learning
// ---------------------------------------------------------------------------

function learnMacs(switches: Array<L2Node & { device: DeviceState }>, links: ResolvedLink[]): void {
  for (const s of switches) s.device.macTable = s.device.macTable.filter((e) => e.type === "STATIC");

  const neighborPort = new Map<InterfaceState, { dev: DeviceState; iface: InterfaceState }>();
  for (const l of links) {
    if (!linkUp(l) || !l.a.node.device || !l.b.node.device) continue;
    neighborPort.set(l.a.iface!, { dev: l.b.node.device, iface: l.b.iface! });
    neighborPort.set(l.b.iface!, { dev: l.a.node.device, iface: l.a.iface! });
  }

  const learn = (dev: DeviceState, port: InterfaceState, vlan: number, mac: string) => {
    const name = shortInterfaceName(port);
    if (dev.macTable.some((e) => e.mac === mac && e.vlan === vlan)) return;
    dev.macTable.push({ vlan, mac, type: "DYNAMIC", port: name });
  };

  for (const l of links) {
    if (!linkUp(l)) continue;
    for (const [sw, src] of [
      [l.a, l.b],
      [l.b, l.a],
    ] as const) {
      const dev = sw.node.device;
      if (!dev || !isSwitch(dev) || !sw.iface?.switchport) continue;
      const mac = src.node.hostMac ?? (src.iface && !src.iface.switchport && src.iface.ipv4 ? src.iface.mac : null);
      if (!mac) continue;
      const ps = sw.iface.portSecurity;
      const known = [...ps.staticMacs, ...ps.stickyMacs];
      // Port-security drops frames from a MAC over the limit (protect/restrict).
      if (ps.enabled && !known.includes(mac) && known.length >= ps.maximum) continue;
      const ingress = logical(dev, sw.iface);
      if (ingress.oper.trunk) continue;
      const vlan = ingress.switchport!.accessVlan;
      if (!dev.vlans.has(vlan)) continue;
      // Flood through forwarding ports of the VLAN's spanning tree.
      const visited = new Set<DeviceState>();
      const queue: Array<{ dev: DeviceState; port: InterfaceState }> = [{ dev, port: ingress }];
      while (queue.length) {
        const { dev: d, port } = queue.shift()!;
        // A blocking port discards frames: it neither learns nor marks the switch as reached.
        const st = port.oper.stp.get(vlan);
        if (visited.has(d) || (st && !st.forwarding)) continue;
        visited.add(d);
        learn(d, port, vlan, mac);
        for (const i of d.interfaces) {
          if (!isPhysical(i) || !portUp(i)) continue;
          const li = logical(d, i);
          if (li === port || !carriesVlan(li, vlan)) continue;
          const lst = li.oper.stp.get(vlan);
          if (lst && !lst.forwarding) continue;
          const n = neighborPort.get(i);
          if (!n || !isSwitch(n.dev) || visited.has(n.dev)) continue;
          const nli = logical(n.dev, n.iface);
          if (!carriesVlan(nli, vlan)) continue;
          queue.push({ dev: n.dev, port: nli });
        }
      }
    }
  }
}
