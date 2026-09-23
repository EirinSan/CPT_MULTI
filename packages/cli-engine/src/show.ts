/** Formatters for `show` commands, matching IOS column layouts. */
import { interfaceStatus, isVirtual, shortInterfaceName } from "./device";
import { maskToPrefix, networkOf } from "./net";
import type { DeviceState } from "./types";

export function showIpInterfaceBrief(dev: DeviceState): string[] {
  const out = [
    `${"Interface".padEnd(23)}${"IP-Address".padEnd(16)}OK? Method ${"Status".padEnd(22)}Protocol`,
  ];
  for (const i of dev.interfaces) {
    const { status, protocol } = interfaceStatus(dev, i);
    const ip = i.ipv4?.address ?? "unassigned";
    const method = i.ipv4 ? "manual" : "unset";
    out.push(`${i.name.padEnd(23)}${ip.padEnd(16)}YES ${method.padEnd(7)}${status.padEnd(22)}${protocol}`);
  }
  return out;
}

const RESERVED_VLANS: Array<[number, string]> = [
  [1002, "fddi-default"],
  [1003, "token-ring-default"],
  [1004, "fddinet-default"],
  [1005, "trnet-default"],
];

export function showVlanBrief(dev: DeviceState): string[] {
  const out = [
    "",
    `VLAN Name                             Status    Ports`,
    `---- -------------------------------- --------- -------------------------------`,
  ];
  const vlans = [...dev.vlans.values()].sort((a, b) => a.id - b.id);
  for (const v of vlans) {
    const ports = dev.interfaces
      .filter((i) => !isVirtual(i) && i.switchport?.mode === "access" && i.switchport.accessVlan === v.id)
      .map(shortInterfaceName);
    const chunks: string[] = [];
    for (let k = 0; k < ports.length; k += 4) chunks.push(ports.slice(k, k + 4).join(", "));
    const head = `${String(v.id).padEnd(5)}${v.name.padEnd(33)}${"active".padEnd(10)}`;
    out.push((head + (chunks[0] ?? "")).trimEnd());
    for (const c of chunks.slice(1)) out.push(" ".repeat(48) + c);
  }
  for (const [id, name] of RESERVED_VLANS) {
    out.push(`${String(id).padEnd(5)}${name.padEnd(33)}act/unsup`);
  }
  return out;
}

export function showIpRoute(dev: DeviceState): string[] {
  const out = [
    "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP",
    "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area",
    "       * - candidate default, U - per-user static route",
    "",
  ];
  const routes: Array<{ code: string; prefix: string; text: string }> = [];
  for (const i of dev.interfaces) {
    if (!i.ipv4 || interfaceStatus(dev, i).protocol !== "up") continue;
    const len = maskToPrefix(i.ipv4.mask)!;
    routes.push({
      code: "C",
      prefix: `${networkOf(i.ipv4.address, i.ipv4.mask)}/${len}`,
      text: `is directly connected, ${i.name}`,
    });
    if (len < 32) {
      routes.push({ code: "L", prefix: `${i.ipv4.address}/32`, text: `is directly connected, ${i.name}` });
    }
  }
  let defaultGw: string | null = null;
  for (const r of dev.staticRoutes) {
    const len = maskToPrefix(r.mask)!;
    if (len === 0) defaultGw = r.nextHop;
    routes.push({
      code: len === 0 ? "S*" : "S",
      prefix: `${r.network}/${len}`,
      text: `[1/0] via ${r.nextHop}`,
    });
  }
  out.push(defaultGw ? `Gateway of last resort is ${defaultGw} to network 0.0.0.0` : "Gateway of last resort is not set");
  out.push("");
  for (const r of routes) out.push(`${r.code.padEnd(9)}${r.prefix} ${r.text}`);
  return out;
}

export function runningConfig(dev: DeviceState): string[] {
  const out = [
    "Building configuration...",
    "",
    "Current configuration:",
    "!",
    "version 15.2",
    "no service timestamps log datetime msec",
    "!",
    `hostname ${dev.hostname}`,
    "!",
  ];
  for (const v of [...dev.vlans.values()].sort((a, b) => a.id - b.id)) {
    if (v.id === 1) continue;
    out.push(`vlan ${v.id}`, ` name ${v.name}`, "!");
  }
  for (const i of dev.interfaces) {
    out.push(`interface ${i.name}`);
    if (i.description) out.push(` description ${i.description}`);
    if (dev.kind === "switch-l3" && i.switchport === null && !isVirtual(i)) out.push(" no switchport");
    if (i.switchport) {
      if (i.switchport.mode === "trunk") out.push(" switchport mode trunk");
      else {
        if (i.switchport.accessVlan !== 1) out.push(` switchport access vlan ${i.switchport.accessVlan}`);
        out.push(" switchport mode access");
      }
    }
    if (i.ipv4) out.push(` ip address ${i.ipv4.address} ${i.ipv4.mask}`);
    else if (!i.switchport) out.push(" no ip address");
    if (!i.adminUp) out.push(" shutdown");
    out.push("!");
  }
  for (const r of dev.staticRoutes) out.push(`ip route ${r.network} ${r.mask} ${r.nextHop}`);
  if (dev.staticRoutes.length) out.push("!");
  out.push("line con 0", "!", "end");
  return out;
}

export function showMacAddressTable(dev: DeviceState): string[] {
  const out = [
    "          Mac Address Table",
    "-------------------------------------------",
    "",
    "Vlan    Mac Address       Type        Ports",
    "----    -----------       --------    -----",
  ];
  const entries = [...dev.macTable].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
  for (const e of entries) {
    out.push(`${String(e.vlan).padStart(4)}    ${e.mac.padEnd(18)}${e.type.padEnd(12)}${e.port}`);
  }
  out.push(`Total Mac Addresses for this criterion: ${entries.length}`);
  return out;
}

export function showVersion(dev: DeviceState, uptime: string): string[] {
  const family = dev.kind === "router" ? "ISR" : "C2960/C3650";
  return [
    `CPT-NOS Software, ${family} Software (${dev.model}), Version 15.2(simulated)`,
    "Compiled for the CPT network simulator",
    "",
    `${dev.hostname} uptime is ${uptime}`,
    "",
    `${dev.model} processor with 524288K bytes of memory.`,
    `${dev.interfaces.filter((i) => i.type === "FastEthernet").length} FastEthernet interfaces`,
    `${dev.interfaces.filter((i) => i.type === "GigabitEthernet").length} Gigabit Ethernet interfaces`,
    "",
    "Configuration register is 0xF",
  ];
}
