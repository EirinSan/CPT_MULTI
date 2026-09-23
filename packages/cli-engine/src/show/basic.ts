/** show ip interface brief / ip route / mac address-table / version. */
import { interfaceStatus } from "../device";
import { computeRib } from "../rib";
import type { DeviceState, MacEntry } from "../types";

export function showIpInterfaceBrief(dev: DeviceState): string[] {
  const out = [`${"Interface".padEnd(23)}${"IP-Address".padEnd(16)}OK? Method ${"Status".padEnd(22)}Protocol`];
  for (const i of dev.interfaces) {
    const { status, protocol } = interfaceStatus(dev, i);
    const ip = i.ipv4?.address ?? "unassigned";
    const method = i.ipv4 ? "manual" : "unset";
    out.push(`${i.name.padEnd(23)}${ip.padEnd(16)}YES ${method.padEnd(7)}${status.padEnd(22)}${protocol}`);
  }
  return out;
}

export function showIpRoute(dev: DeviceState): string[] {
  if (dev.kind === "switch-l3" && !dev.ipRouting) {
    return [dev.defaultGateway ? `Default gateway is ${dev.defaultGateway}` : "Default gateway is not set", "", "Host               Gateway           Last Use    Total Uses  Interface", "ICMP redirect cache is empty"];
  }
  const out = [
    "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP",
    "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area",
    "       * - candidate default, U - per-user static route",
    "",
  ];
  const rib = computeRib(dev);
  const def = rib.find((r) => r.code === "S" && r.prefixLength === 0);
  out.push(def ? `Gateway of last resort is ${def.nextHop} to network 0.0.0.0` : "Gateway of last resort is not set");
  out.push("");
  for (const r of rib) {
    const code = r.code === "S" && r.prefixLength === 0 ? "S*" : r.code;
    const text = r.code === "S" ? `[1/0] via ${r.nextHop}` : `is directly connected, ${r.outInterface}`;
    out.push(`${code.padEnd(9)}${r.network}/${r.prefixLength} ${text}`);
  }
  return out;
}

export function showMacAddressTable(dev: DeviceState, filter: (e: MacEntry) => boolean = () => true): string[] {
  const out = [
    "          Mac Address Table",
    "-------------------------------------------",
    "",
    "Vlan    Mac Address       Type        Ports",
    "----    -----------       --------    -----",
  ];
  const entries = dev.macTable.filter(filter).sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
  for (const e of entries) out.push(`${String(e.vlan).padStart(4)}    ${e.mac.padEnd(18)}${e.type.padEnd(12)}${e.port}`);
  out.push(`Total Mac Addresses for this criterion: ${entries.length}`);
  return out;
}

export function showMacAddressCount(dev: DeviceState): string[] {
  const dyn = dev.macTable.filter((e) => e.type === "DYNAMIC").length;
  const st = dev.macTable.length - dyn;
  return [
    "",
    "Mac Entries for all vlans :",
    "---------------------------",
    `Dynamic Address Count  : ${dyn}`,
    `Static  Address Count  : ${st}`,
    `Total Mac Addresses    : ${dev.macTable.length}`,
    "",
    "Total Mac Address Space Available: 8189",
  ];
}

export function showVersion(dev: DeviceState, uptime: string): string[] {
  const ios =
    dev.kind === "router"
      ? "Cisco IOS XE Software, Version 16.09.04"
      : `Cisco IOS Software, ${dev.kind === "switch-l3" ? "C3560" : "C2960"} Software (${dev.kind === "switch-l3" ? "C3560-IPSERVICESK9-M" : "C2960-LANBASEK9-M"}), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)`;
  return [
    ios,
    "Technical Support: http://www.cisco.com/techsupport",
    "(simulated by CPT Multi)",
    "",
    `ROM: Bootstrap program is ${dev.kind === "router" ? "IOS-XE ROMMON" : "C2960 boot loader"}`,
    "",
    `${dev.hostname} uptime is ${uptime}`,
    'System image file is "flash:/ios.bin"',
    "",
    `cisco ${dev.model} processor with 65536K bytes of memory.`,
    `${dev.interfaces.filter((i) => i.type === "FastEthernet").length} FastEthernet interfaces`,
    `${dev.interfaces.filter((i) => i.type === "GigabitEthernet").length} Gigabit Ethernet interfaces`,
    "64K bytes of flash-simulated non-volatile configuration memory.",
    `Base ethernet MAC Address       : ${dev.baseMac.replace(/\./g, "").replace(/(..)(?!$)/g, "$1:").toUpperCase()}`,
    `Model number                    : ${dev.model}`,
    "",
    "Configuration register is 0xF",
  ];
}
