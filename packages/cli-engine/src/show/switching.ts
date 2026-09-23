/** show vlan / spanning-tree / port-security / etherchannel / vtp / cdp. */
import { channelMembers, interfaceStatus, isVirtual, shortInterfaceName } from "../device";
import { bridgeId, portfastOper, stpPortNumber } from "../l2";
import type { DeviceState, InterfaceState } from "../types";

const RESERVED_VLANS: Array<[number, string]> = [
  [1002, "fddi-default"],
  [1003, "token-ring-default"],
  [1004, "fddinet-default"],
  [1005, "trnet-default"],
];

function vlanPorts(dev: DeviceState, vlan: number): string[] {
  return dev.interfaces
    .filter((i) => {
      if (isVirtual(i) || !i.switchport || i.oper.trunk) return false;
      if (i.channelGroup && i.oper.bundled) return false;
      return i.switchport.accessVlan === vlan || i.switchport.voiceVlan === vlan;
    })
    .map(shortInterfaceName);
}

function vlanRows(dev: DeviceState, ids?: number[]): string[] {
  const out: string[] = [];
  const vlans = [...dev.vlans.values()].filter((v) => !ids || ids.includes(v.id)).sort((a, b) => a.id - b.id);
  for (const v of vlans) {
    const ports = vlanPorts(dev, v.id);
    const chunks: string[] = [];
    for (let k = 0; k < ports.length; k += 4) chunks.push(ports.slice(k, k + 4).join(", "));
    const head = `${String(v.id).padEnd(5)}${v.name.padEnd(33)}${"active".padEnd(10)}`;
    out.push((head + (chunks[0] ?? "")).trimEnd());
    for (const c of chunks.slice(1)) out.push(" ".repeat(48) + c);
  }
  if (!ids) for (const [id, name] of RESERVED_VLANS) out.push(`${String(id).padEnd(5)}${name.padEnd(33)}act/unsup`);
  return out;
}

export function showVlanBrief(dev: DeviceState): string[] {
  return [
    "",
    "VLAN Name                             Status    Ports",
    "---- -------------------------------- --------- -------------------------------",
    ...vlanRows(dev),
  ];
}

export function showVlan(dev: DeviceState, id?: number): string[] {
  if (id !== undefined && !dev.vlans.has(id)) return [`VLAN id ${id} not found in current VLAN database`];
  const ids = id === undefined ? undefined : [id];
  const typeRows = [...dev.vlans.values()]
    .filter((v) => !ids || ids.includes(v.id))
    .sort((a, b) => a.id - b.id)
    .map((v) => `${String(v.id).padEnd(5)}enet  ${String(100000 + v.id).padEnd(7)}1500  -      -      -        -    -        0      0`);
  return [
    ...showVlanBrief(dev).slice(0, 3),
    ...vlanRows(dev, ids),
    "",
    "VLAN Type  SAID       MTU   Parent RingNo BridgeNo Stp  BrdgMode Trans1 Trans2",
    "---- ----- ---------- ----- ------ ------ -------- ---- -------- ------ ------",
    ...typeRows,
    "",
    "Remote SPAN VLANs",
    "------------------------------------------------------------------------------",
    "",
    "",
    "Primary Secondary Type              Ports",
    "------- --------- ----------------- ------------------------------------------",
  ];
}

// ---------------------------------------------------------------------------
// Spanning tree
// ---------------------------------------------------------------------------

function protocolName(dev: DeviceState): string {
  return dev.stp.mode === "rapid-pvst" ? "rstp" : dev.stp.mode === "mst" ? "mstp" : "ieee";
}

function stpPorts(dev: DeviceState, vlan: number): InterfaceState[] {
  return dev.interfaces.filter((i) => i.oper.stp.has(vlan) && !(i.channelGroup && i.oper.bundled));
}

export function showSpanningTreeVlan(dev: DeviceState, vlan: number): string[] {
  const root = dev.stp.root.get(vlan);
  const ports = stpPorts(dev, vlan);
  const vname = `VLAN${String(vlan).padStart(4, "0")}`;
  if (!root || ports.length === 0) return [`Spanning tree instance(s) for vlan ${vlan} does not exist.`];
  const me = bridgeId(dev, vlan);
  const isRoot = root.mac === me.mac && root.priority === me.priority;
  const configured = dev.stp.priorities.get(vlan) ?? 32768;
  const out = [vname, `  Spanning tree enabled protocol ${protocolName(dev)}`, `  Root ID    Priority    ${root.priority}`, `             Address     ${root.mac}`];
  if (isRoot) out.push("             This bridge is the root");
  else {
    const rp = dev.interfaces.find((i) => i.name === root.port);
    out.push(`             Cost        ${root.cost}`, `             Port        ${rp ? stpPortNumber(dev, rp) : 0} (${root.port})`);
  }
  out.push(
    "             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec",
    "",
    `  Bridge ID  Priority    ${me.priority}  (priority ${configured} sys-id-ext ${vlan})`,
    `             Address     ${me.mac}`,
    "             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec",
    "             Aging Time  300 sec",
    "",
    "Interface           Role Sts Cost      Prio.Nbr Type",
    "------------------- ---- --- --------- -------- --------------------------------",
  );
  for (const i of ports) {
    const st = i.oper.stp.get(vlan)!;
    const edge = portfastOper(dev, i) ? " Edge" : "";
    const sts = st.forwarding ? "FWD" : "BLK";
    out.push(
      `${shortInterfaceName(i).padEnd(20)}${st.role.padEnd(5)}${sts} ${String(st.cost).padEnd(10)}${`${i.stp.portPriority}.${stpPortNumber(dev, i)}`.padEnd(9)}P2p${edge}`,
    );
  }
  return out;
}

export function showSpanningTree(dev: DeviceState, vlan?: number): string[] {
  const vlans = vlan !== undefined ? [vlan] : [...dev.stp.root.keys()].sort((a, b) => a - b);
  const out: string[] = [];
  for (const v of vlans) {
    const block = showSpanningTreeVlan(dev, v);
    if (vlan === undefined && block.length === 1) continue;
    out.push("", ...block);
  }
  return out.length ? out : ["No spanning tree instance exists."];
}

export function showSpanningTreeSummary(dev: DeviceState): string[] {
  const rootFor = [...dev.stp.root.entries()]
    .filter(([v, r]) => r.mac === dev.baseMac && r.priority === bridgeId(dev, v).priority)
    .map(([v]) => `VLAN${String(v).padStart(4, "0")}`);
  const onOff = (b: boolean) => (b ? "is enabled" : "is disabled");
  const out = [
    `Switch is in ${dev.stp.mode} mode`,
    `Root bridge for: ${rootFor.join(", ") || "none"}`,
    "Extended system ID                      is enabled",
    `Portfast Default                        ${onOff(dev.stp.portfastDefault)}`,
    `PortFast BPDU Guard Default             ${onOff(dev.stp.bpduguardDefault)}`,
    "Portfast BPDU Filter Default            is disabled",
    "Loopguard Default                       is disabled",
    "EtherChannel misconfig guard            is enabled",
    "UplinkFast                              is disabled",
    "BackboneFast                            is disabled",
    "Pathcost method used                    is short",
    "",
    "Name                   Blocking Listening Learning Forwarding STP Active",
    "---------------------- -------- --------- -------- ---------- ----------",
  ];
  let tb = 0;
  let tf = 0;
  const vlans = [...dev.stp.root.keys()].sort((a, b) => a - b);
  for (const v of vlans) {
    const ports = stpPorts(dev, v);
    const b = ports.filter((i) => !i.oper.stp.get(v)!.forwarding).length;
    const f = ports.length - b;
    tb += b;
    tf += f;
    out.push(`${`VLAN${String(v).padStart(4, "0")}`.padEnd(23)}${String(b).padStart(8)}${"0".padStart(10)}${"0".padStart(9)}${String(f).padStart(11)}${String(b + f).padStart(11)}`);
  }
  out.push(
    "---------------------- -------- --------- -------- ---------- ----------",
    `${`${vlans.length} vlans`.padEnd(23)}${String(tb).padStart(8)}${"0".padStart(10)}${"0".padStart(9)}${String(tf).padStart(11)}${String(tb + tf).padStart(11)}`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Port security
// ---------------------------------------------------------------------------

function currentAddresses(dev: DeviceState, i: InterfaceState): number {
  const ps = i.portSecurity;
  const learned = dev.macTable.filter((e) => e.port === shortInterfaceName(i) && e.type === "DYNAMIC").length;
  return Math.max(ps.staticMacs.length + ps.stickyMacs.length, Math.min(learned, ps.maximum));
}

export function showPortSecurity(dev: DeviceState): string[] {
  const out = [
    "Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action",
    "                (Count)       (Count)          (Count)",
    "---------------------------------------------------------------------------",
  ];
  let total = 0;
  for (const i of dev.interfaces) {
    const ps = i.portSecurity;
    if (!ps.enabled) continue;
    const cur = currentAddresses(dev, i);
    total += cur;
    const action = ps.violation[0]!.toUpperCase() + ps.violation.slice(1);
    out.push(`${shortInterfaceName(i).padStart(11)}${String(ps.maximum).padStart(15)}${String(cur).padStart(13)}${String(ps.violationCount).padStart(19)}${action.padStart(18)}`);
  }
  out.push(
    "---------------------------------------------------------------------------",
    `Total Addresses in System (excluding one mac per port)     : ${Math.max(0, total - dev.interfaces.filter((i) => i.portSecurity.enabled).length)}`,
    "Max Addresses limit in System (excluding one mac per port) : 8192",
  );
  return out;
}

export function showPortSecurityInterface(dev: DeviceState, i: InterfaceState): string[] {
  const ps = i.portSecurity;
  const up = interfaceStatus(dev, i).protocol === "up";
  const status = !ps.enabled ? "Secure-down" : i.errDisabled === "psecure-violation" ? "Secure-shutdown" : up ? "Secure-up" : "Secure-down";
  return [
    `Port Security              : ${ps.enabled ? "Enabled" : "Disabled"}`,
    `Port Status                : ${status}`,
    `Violation Mode             : ${ps.violation[0]!.toUpperCase() + ps.violation.slice(1)}`,
    `Aging Time                 : ${ps.agingMinutes} mins`,
    "Aging Type                 : Absolute",
    "SecureStatic Address Aging : Disabled",
    `Maximum MAC Addresses      : ${ps.maximum}`,
    `Total MAC Addresses        : ${ps.enabled ? currentAddresses(dev, i) : 0}`,
    `Configured MAC Addresses   : ${ps.staticMacs.length}`,
    `Sticky MAC Addresses       : ${ps.stickyMacs.length}`,
    `Last Source Address:Vlan   : ${ps.lastSource ?? "0000.0000.0000"}:${ps.lastSource ? i.switchport?.accessVlan ?? 0 : 0}`,
    `Security Violation Count   : ${ps.violationCount}`,
  ];
}

export function showPortSecurityAddress(dev: DeviceState): string[] {
  const out = [
    "               Secure Mac Address Table",
    "-----------------------------------------------------------------------------",
    "Vlan    Mac Address       Type                          Ports   Remaining Age",
    "                                                                   (mins)",
    "----    -----------       ----                          -----   -------------",
  ];
  let n = 0;
  for (const i of dev.interfaces) {
    if (!i.portSecurity.enabled || !i.switchport) continue;
    const v = String(i.switchport.accessVlan).padStart(4);
    for (const m of i.portSecurity.staticMacs) {
      out.push(`${v}    ${m.padEnd(18)}${"SecureConfigured".padEnd(30)}${shortInterfaceName(i).padEnd(8)}    -`);
      n++;
    }
    for (const m of i.portSecurity.stickyMacs) {
      out.push(`${v}    ${m.padEnd(18)}${"SecureSticky".padEnd(30)}${shortInterfaceName(i).padEnd(8)}    -`);
      n++;
    }
  }
  out.push("-----------------------------------------------------------------------------", `Total Addresses in System (excluding one mac per port)     : ${n}`);
  return out;
}

// ---------------------------------------------------------------------------
// EtherChannel
// ---------------------------------------------------------------------------

export function showEtherchannelSummary(dev: DeviceState): string[] {
  const pos = dev.interfaces.filter((i) => i.type === "Port-channel");
  const out = [
    "Flags:  D - down        P - bundled in port-channel",
    "        I - stand-alone s - suspended",
    "        H - Hot-standby (LACP only)",
    "        R - Layer3      S - Layer2",
    "        U - in use      f - failed to allocate aggregator",
    "",
    "        M - not in use, minimum links not met",
    "        u - unsuitable for bundling",
    "        w - waiting to be aggregated",
    "        d - default port",
    "",
    "",
    `Number of channel-groups in use: ${pos.length}`,
    `Number of aggregators:           ${pos.length}`,
    "",
    "Group  Port-channel  Protocol    Ports",
    "------+-------------+-----------+-----------------------------------------------",
  ];
  for (const po of pos) {
    const members = channelMembers(dev, po);
    const up = interfaceStatus(dev, po).protocol === "up";
    const flags = `${po.switchport ? "S" : "R"}${up ? "U" : "D"}`;
    const mode = members[0]?.channelGroup?.mode;
    const proto = mode === "active" || mode === "passive" ? "LACP" : mode === "desirable" || mode === "auto" ? "PAgP" : "-";
    const ports = members
      .map((m) => {
        const f = m.oper.bundled ? "P" : !m.adminUp || !m.carrier || m.errDisabled ? "D" : m.channelGroup?.mode === "on" ? "D" : "I";
        return `${shortInterfaceName(m)}(${f})`;
      })
      .join("   ");
    out.push(`${String(po.number).padEnd(7)}${`Po${po.number}(${flags})`.padEnd(14)}${proto.padEnd(12)}${ports}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// VTP / CDP
// ---------------------------------------------------------------------------

export function showVtpStatus(dev: DeviceState): string[] {
  const mode = { server: "Server", client: "Client", transparent: "Transparent", off: "Off" }[dev.vtp.mode];
  return [
    "VTP Version capable             : 1 to 3",
    `VTP version running             : ${dev.vtp.version}`,
    `VTP Domain Name                 : ${dev.vtp.domain}`,
    `VTP Pruning Mode                : ${dev.vtp.pruning ? "Enabled" : "Disabled"}`,
    "VTP Traps Generation            : Disabled",
    `Device ID                       : ${dev.baseMac}`,
    "Configuration last modified by 0.0.0.0 at 0-0-00 00:00:00",
    "Local updater ID is 0.0.0.0 (no valid interface found)",
    "",
    "Feature VLAN:",
    "--------------",
    `VTP Operating Mode                : ${mode}`,
    "Maximum VLANs supported locally   : 255",
    `Number of existing VLANs          : ${dev.vlans.size + 4}`,
    `Configuration Revision            : ${dev.vtp.mode === "transparent" || dev.vtp.mode === "off" ? 0 : dev.vtp.revision}`,
    "MD5 digest                        : 0x3F 0x37 0x45 0x9A 0x37 0x53 0xA6 0xDE",
    "                                    0xAB 0xC3 0x2C 0x9C 0x16 0x1D 0x7E 0xB8",
  ];
}

function cdpPort(name: string): string {
  const m = /^([A-Za-z]+)(.*)$/.exec(name);
  return m ? `${m[1]!.slice(0, 3)} ${m[2]}` : name;
}

export function showCdpNeighbors(dev: DeviceState, detail: boolean): string[] {
  if (!dev.cdpRun) return ["% CDP is not enabled"];
  const ports = dev.interfaces.filter((i) => i.oper.neighbor);
  if (detail) {
    const out: string[] = [];
    for (const i of ports) {
      const n = i.oper.neighbor!;
      out.push(
        "-------------------------",
        `Device ID: ${n.deviceId}`,
        "Entry address(es): ",
        ...(n.ipAddress ? [`  IP address: ${n.ipAddress}`] : []),
        `Platform: cisco ${n.platform},  Capabilities: ${n.capabilities
          .split(" ")
          .map((c) => ({ R: "Router", S: "Switch", I: "IGMP", B: "Source-Route-Bridge" })[c] ?? c)
          .join(" ")}`,
        `Interface: ${i.name},  Port ID (outgoing port): ${n.portId}`,
        "Holdtime : 165 sec",
        "",
        "Version :",
        `Cisco IOS Software, ${n.version}`,
        "",
        "advertisement version: 2",
        ...(n.nativeVlan !== null ? [`Native VLAN: ${n.nativeVlan}`] : []),
        "Duplex: full",
        "",
      );
    }
    out.push(`Total cdp entries displayed : ${ports.length}`);
    return out;
  }
  const out = [
    "Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge",
    "                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone,",
    "                  D - Remote, C - CVTA, M - Two-port Mac Relay",
    "",
    "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID",
  ];
  for (const i of ports) {
    const n = i.oper.neighbor!;
    out.push(
      `${n.deviceId.slice(0, 16).padEnd(17)}${cdpPort(shortInterfaceName(i).replace(/^Fa/, "FastEthernet").replace(/^Gi/, "GigabitEthernet")).padEnd(18)}${"165".padEnd(11)}${n.capabilities.padStart(10)}  ${n.platform.slice(0, 9).padEnd(10)}${cdpPort(n.portId)}`,
    );
  }
  out.push("", `Total cdp entries displayed : ${ports.length}`);
  return out;
}

export function showCdp(dev: DeviceState): string[] {
  if (!dev.cdpRun) return ["% CDP is not enabled"];
  return [
    "Global CDP information:",
    "        Sending CDP packets every 60 seconds",
    "        Sending a holdtime value of 180 seconds",
    "        Sending CDPv2 advertisements is  enabled",
  ];
}

