/** show interfaces [...] */
import { INTERFACE_TYPES, bandwidthMbps, interfaceStatus, isPhysical, isVirtual, shortInterfaceName } from "../device";
import { maskToPrefix, formatVlanList } from "../net";
import type { DeviceState, InterfaceState } from "../types";

function hardware(i: InterfaceState): string {
  switch (i.type) {
    case "FastEthernet":
      return "Fast Ethernet";
    case "GigabitEthernet":
      return "Gigabit Ethernet";
    case "Vlan":
      return "EtherSVI";
    case "Loopback":
      return "Loopback";
    case "Port-channel":
      return "EtherChannel";
  }
}

function duplexSpeed(dev: DeviceState, i: InterfaceState): { duplex: string; speed: string } {
  const up = interfaceStatus(dev, i).protocol === "up";
  const bw = i.type === "FastEthernet" ? 100 : 1000;
  const duplex = i.duplex === "auto" ? (up ? "a-full" : "auto") : i.duplex;
  const speed = i.speed === "auto" ? (up ? `a-${bw}` : "auto") : i.speed;
  return { duplex, speed };
}

/** Column "Status" of show interfaces status. */
export function portState(dev: DeviceState, i: InterfaceState): string {
  if (i.errDisabled) return "err-disabled";
  if (!i.adminUp) return "disabled";
  if (i.channelGroup && !i.oper.bundled && i.carrier) return "suspended";
  return interfaceStatus(dev, i).protocol === "up" ? "connected" : "notconnect";
}

export function showInterfacesStatus(dev: DeviceState, only?: InterfaceState[]): string[] {
  const out = ["", "Port      Name               Status       Vlan       Duplex  Speed Type"];
  for (const i of only ?? dev.interfaces) {
    if (isVirtual(i)) continue;
    const vlan = !i.switchport ? "routed" : i.oper.trunk ? "trunk" : String(i.switchport.accessVlan);
    const { duplex, speed } = duplexSpeed(dev, i);
    const type = i.type === "FastEthernet" ? "10/100BaseTX" : i.type === "Port-channel" ? "" : "10/100/1000BaseTX";
    out.push(
      `${shortInterfaceName(i).padEnd(10)}${(i.description ?? "").slice(0, 18).padEnd(19)}${portState(dev, i).padEnd(13)}${vlan.padEnd(11)}${duplex.padStart(6)} ${speed.padStart(6)} ${type}`.trimEnd(),
    );
  }
  return out;
}

export function showInterfaces(dev: DeviceState, i: InterfaceState): string[] {
  const { status, protocol } = interfaceStatus(dev, i);
  const connected = isPhysical(i) ? ` (${portState(dev, i)})` : "";
  const shownStatus = i.errDisabled ? "down" : status;
  const out = [`${i.name} is ${shownStatus}, line protocol is ${protocol}${connected}`];
  out.push(`  Hardware is ${hardware(i)}, address is ${i.mac} (bia ${i.mac})`);
  if (i.description) out.push(`  Description: ${i.description}`);
  if (i.ipv4) out.push(`  Internet address is ${i.ipv4.address}/${maskToPrefix(i.ipv4.mask)}`);
  const bw = isVirtual(i) ? 1000000 : bandwidthMbps(dev, i) * 1000;
  out.push(`  MTU 1500 bytes, BW ${bw} Kbit/sec, DLY ${i.type === "FastEthernet" ? 100 : 10} usec,`);
  out.push("     reliability 255/255, txload 1/255, rxload 1/255");
  out.push("  Encapsulation ARPA, loopback not set");
  if (isPhysical(i)) {
    out.push("  Keepalive set (10 sec)");
    const { duplex, speed } = duplexSpeed(dev, i);
    const d = duplex.replace("a-", "");
    const sp = speed.replace("a-", "");
    out.push(
      protocol === "up"
        ? `  ${d === "full" ? "Full" : d === "half" ? "Half" : "Auto"}-duplex, ${sp}Mb/s, media type is ${i.type === "FastEthernet" ? "10/100BaseTX" : "10/100/1000BaseTX"}`
        : `  Auto-duplex, Auto-speed, media type is ${i.type === "FastEthernet" ? "10/100BaseTX" : "10/100/1000BaseTX"}`,
    );
    out.push("  input flow-control is off, output flow-control is unsupported");
  }
  if (i.type === "Port-channel") {
    const members = dev.interfaces.filter((m) => m.channelGroup?.id === Number(i.number) && m.oper.bundled);
    out.push(`  Members in this channel: ${members.map(shortInterfaceName).join(" ")}`);
  }
  out.push(
    "  ARP type: ARPA, ARP Timeout 04:00:00",
    "  Last input never, output never, output hang never",
    "  Last clearing of \"show interface\" counters never",
    "  Input queue: 0/75/0/0 (size/max/drops/flushes); Total output drops: 0",
    "  Queueing strategy: fifo",
    "  Output queue: 0/40 (size/max)",
    "  5 minute input rate 0 bits/sec, 0 packets/sec",
    "  5 minute output rate 0 bits/sec, 0 packets/sec",
    "     0 packets input, 0 bytes, 0 no buffer",
    "     Received 0 broadcasts (0 multicasts)",
    "     0 runts, 0 giants, 0 throttles",
    "     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored",
    "     0 packets output, 0 bytes, 0 underruns",
    "     0 output errors, 0 collisions, 0 interface resets",
  );
  return out;
}

export function showInterfacesDescription(dev: DeviceState): string[] {
  const out = [`${"Interface".padEnd(31)}${"Status".padEnd(15)}${"Protocol".padEnd(9)}Description`];
  for (const i of dev.interfaces) {
    const { status, protocol } = interfaceStatus(dev, i);
    const st = status === "administratively down" ? "admin down" : status;
    out.push(`${shortInterfaceName(i).padEnd(31)}${st.padEnd(15)}${protocol.padEnd(9)}${i.description ?? ""}`.trimEnd());
  }
  return out;
}

function vlanListOrAll(v: "all" | number[]): string {
  return v === "all" ? "1-4094" : formatVlanList(v);
}

export function showInterfacesTrunk(dev: DeviceState): string[] {
  const trunks = dev.interfaces.filter(
    (i) => i.switchport && i.oper.trunk && interfaceStatus(dev, i).protocol === "up" && !(i.channelGroup && i.oper.bundled),
  );
  if (trunks.length === 0) return [];
  const active = (i: InterfaceState) => {
    const allowed = i.switchport!.allowedVlans;
    return [...dev.vlans.keys()].filter((v) => (v < 1002 || v > 1005) && (allowed === "all" || allowed.includes(v)));
  };
  const out = ["", "Port        Mode             Encapsulation  Status        Native vlan"];
  for (const i of trunks) {
    const sp = i.switchport!;
    const mode = sp.mode === "trunk" ? "on" : sp.mode === "dynamic-desirable" ? "desirable" : "auto";
    out.push(`${shortInterfaceName(i).padEnd(12)}${mode.padEnd(17)}${"802.1q".padEnd(15)}${"trunking".padEnd(14)}${sp.nativeVlan}`);
  }
  out.push("", "Port        Vlans allowed on trunk");
  for (const i of trunks) out.push(`${shortInterfaceName(i).padEnd(12)}${vlanListOrAll(i.switchport!.allowedVlans)}`);
  out.push("", "Port        Vlans allowed and active in management domain");
  for (const i of trunks) out.push(`${shortInterfaceName(i).padEnd(12)}${formatVlanList(active(i))}`);
  out.push("", "Port        Vlans in spanning tree forwarding state and not pruned");
  for (const i of trunks) {
    const fwd = active(i).filter((v) => i.oper.stp.get(v)?.forwarding ?? true);
    out.push(`${shortInterfaceName(i).padEnd(12)}${formatVlanList(fwd)}`);
  }
  return out;
}

export function showInterfaceSwitchport(dev: DeviceState, i: InterfaceState): string[] {
  const sp = i.switchport;
  const out = [`Name: ${shortInterfaceName(i)}`];
  if (!sp) return [...out, "Switchport: Disabled"];
  const admin = {
    access: "static access",
    trunk: "trunk",
    "dynamic-auto": "dynamic auto",
    "dynamic-desirable": "dynamic desirable",
  }[sp.mode];
  const up = interfaceStatus(dev, i).protocol === "up";
  const oper = !up ? "down" : i.oper.trunk ? "trunk" : "static access";
  const vname = (v: number) => dev.vlans.get(v)?.name ?? "Inactive";
  out.push(
    "Switchport: Enabled",
    `Administrative Mode: ${admin}`,
    `Operational Mode: ${oper}`,
    `Administrative Trunking Encapsulation: ${sp.encapsulation}`,
    `Operational Trunking Encapsulation: ${i.oper.trunk ? "dot1q" : "native"}`,
    `Negotiation of Trunking: ${sp.nonegotiate || sp.mode === "access" ? "Off" : "On"}`,
    `Access Mode VLAN: ${sp.accessVlan} (${vname(sp.accessVlan)})`,
    `Trunking Native Mode VLAN: ${sp.nativeVlan} (${vname(sp.nativeVlan)})`,
    "Administrative Native VLAN tagging: enabled",
    `Voice VLAN: ${sp.voiceVlan ?? "none"}`,
    "Administrative private-vlan host-association: none",
    "Administrative private-vlan mapping: none",
    "Operational private-vlan: none",
    `Trunking VLANs Enabled: ${sp.allowedVlans === "all" ? "ALL" : formatVlanList(sp.allowedVlans)}`,
    "Pruning VLANs Enabled: 2-1001",
    "Capture Mode Disabled",
    "Capture VLANs Allowed: ALL",
    "",
    "Protected: false",
    "Unknown unicast blocked: disabled",
    "Unknown multicast blocked: disabled",
    "Appliance trust: none",
  );
  return out;
}

export function interfaceTypeNames(): string[] {
  return Object.keys(INTERFACE_TYPES);
}
