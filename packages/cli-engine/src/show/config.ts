/** running-config / startup-config rendering (re-loadable by loadConfig). */
import { isVirtual } from "../device";
import { formatVlanList } from "../net";
import { formatSecret, type7Encode } from "../passwords";
import type { DeviceState, InterfaceState, LineConfig } from "../types";

function secretLine(dev: DeviceState, plain: string): string {
  return dev.servicePasswordEncryption ? `7 ${type7Encode(plain)}` : plain;
}

export function interfaceConfig(dev: DeviceState, i: InterfaceState): string[] {
  const out = [`interface ${i.name}`];
  if (i.description) out.push(` description ${i.description}`);
  const sp = i.switchport;
  if (dev.kind === "switch-l3" && !sp && !isVirtual(i)) out.push(" no switchport");
  if (sp) {
    if (sp.accessVlan !== 1) out.push(` switchport access vlan ${sp.accessVlan}`);
    if (sp.encapsulation !== "negotiate" && dev.kind === "switch-l3") out.push(` switchport trunk encapsulation ${sp.encapsulation}`);
    if (sp.nativeVlan !== 1) out.push(` switchport trunk native vlan ${sp.nativeVlan}`);
    if (sp.allowedVlans !== "all") out.push(` switchport trunk allowed vlan ${formatVlanList(sp.allowedVlans)}`);
    if (sp.mode !== "dynamic-auto") out.push(` switchport mode ${sp.mode.replace("-", " ")}`);
    if (sp.nonegotiate) out.push(" switchport nonegotiate");
    if (sp.voiceVlan !== null) out.push(` switchport voice vlan ${sp.voiceVlan}`);
    const ps = i.portSecurity;
    if (ps.enabled) out.push(" switchport port-security");
    if (ps.maximum !== 1) out.push(` switchport port-security maximum ${ps.maximum}`);
    if (ps.violation !== "shutdown") out.push(` switchport port-security violation ${ps.violation}`);
    if (ps.agingMinutes) out.push(` switchport port-security aging time ${ps.agingMinutes}`);
    if (ps.sticky) out.push(" switchport port-security mac-address sticky");
    for (const m of ps.stickyMacs) out.push(` switchport port-security mac-address sticky ${m}`);
    for (const m of ps.staticMacs) out.push(` switchport port-security mac-address ${m}`);
  }
  if (i.speed !== "auto") out.push(` speed ${i.speed}`);
  if (i.duplex !== "auto") out.push(` duplex ${i.duplex}`);
  if (!i.cdpEnabled) out.push(" no cdp enable");
  if (i.channelGroup) out.push(` channel-group ${i.channelGroup.id} mode ${i.channelGroup.mode}`);
  if (i.stp.portfast === "enable") out.push(" spanning-tree portfast");
  if (i.stp.portfast === "trunk") out.push(" spanning-tree portfast trunk");
  if (i.stp.portfast === "disable") out.push(" spanning-tree portfast disable");
  if (i.stp.bpduguard !== "default") out.push(` spanning-tree bpduguard ${i.stp.bpduguard}`);
  if (i.stp.cost !== null) out.push(` spanning-tree cost ${i.stp.cost}`);
  if (i.stp.portPriority !== 128) out.push(` spanning-tree port-priority ${i.stp.portPriority}`);
  if (i.dhcpSnoopingTrust) out.push(" ip dhcp snooping trust");
  if (i.arpInspectionTrust) out.push(" ip arp inspection trust");
  if (i.ipv4) out.push(` ip address ${i.ipv4.address} ${i.ipv4.mask}`);
  else if (!sp) out.push(" no ip address");
  for (const h of i.helperAddresses) out.push(` ip helper-address ${h}`);
  if (!i.adminUp) out.push(" shutdown");
  return out;
}

function lineBody(dev: DeviceState, l: LineConfig, isVty: boolean): string[] {
  const out: string[] = [];
  if (l.execTimeout[0] !== 10 || l.execTimeout[1] !== 0) out.push(` exec-timeout ${l.execTimeout[0]} ${l.execTimeout[1]}`);
  if (l.privilegeLevel !== null) out.push(` privilege level ${l.privilegeLevel}`);
  if (l.password) out.push(` password ${secretLine(dev, l.password)}`);
  if (l.loggingSynchronous) out.push(" logging synchronous");
  if (l.historySize !== 10) out.push(` history size ${l.historySize}`);
  if (l.login === "line") out.push(" login");
  if (l.login === "local") out.push(" login local");
  if (isVty && l.transportInput !== "all") {
    out.push(` transport input ${Array.isArray(l.transportInput) ? l.transportInput.join(" ") : l.transportInput}`);
  }
  return out;
}

function vtyBlocks(dev: DeviceState): string[] {
  const out: string[] = [];
  const bodies = dev.lines.vty.map((l) => lineBody(dev, l, true).join("\n"));
  let start = 0;
  for (let i = 1; i <= bodies.length; i++) {
    // IOS always splits at 5 (vty 0 4 / vty 5 15).
    if (i === bodies.length || i === 5 || bodies[i] !== bodies[start]) {
      out.push(`line vty ${start} ${i - 1}`, ...lineBody(dev, dev.lines.vty[start]!, true));
      start = i;
    }
  }
  return out;
}

export function runningConfig(dev: DeviceState): string[] {
  const body: string[] = [
    "!",
    dev.kind === "router" ? "version 16.9" : "version 15.0",
    "no service pad",
    "service timestamps debug datetime msec",
    "service timestamps log datetime msec",
    dev.servicePasswordEncryption ? "service password-encryption" : "no service password-encryption",
    "!",
    `hostname ${dev.hostname}`,
    "!",
    "boot-start-marker",
    "boot-end-marker",
    "!",
  ];
  if (dev.enableSecret) body.push(`enable secret ${formatSecret(dev.enableSecret)}`);
  if (dev.enablePassword) body.push(`enable password ${secretLine(dev, dev.enablePassword)}`);
  if (dev.enableSecret || dev.enablePassword) body.push("!");
  for (const [name, u] of dev.users) {
    const priv = u.privilege !== 1 ? ` privilege ${u.privilege}` : "";
    if (u.secret) body.push(`username ${name}${priv} secret ${formatSecret(u.secret)}`);
    else body.push(`username ${name}${priv} password ${secretLine(dev, u.password ?? "")}`);
  }
  body.push("no aaa new-model");
  if (dev.kind === "switch-l3" && dev.ipRouting) body.push("ip routing");
  if (dev.kind === "router" && !dev.ipRouting) body.push("no ip routing");
  body.push("!");
  if (dev.domainName) body.push(`ip domain-name ${dev.domainName}`);
  if (!dev.domainLookup) body.push("no ip domain-lookup");
  for (const ns of dev.nameServers) body.push(`ip name-server ${ns}`);
  if (dev.dhcpSnooping.vlans.length) body.push(`ip dhcp snooping vlan ${formatVlanList(dev.dhcpSnooping.vlans)}`);
  if (dev.dhcpSnooping.enabled) body.push("ip dhcp snooping");
  if (dev.arpInspectionVlans.length) body.push(`ip arp inspection vlan ${formatVlanList(dev.arpInspectionVlans)}`);
  body.push("!");

  if (dev.kind !== "router") {
    body.push(`spanning-tree mode ${dev.stp.mode}`);
    if (dev.stp.portfastDefault) body.push("spanning-tree portfast default");
    if (dev.stp.bpduguardDefault) body.push("spanning-tree portfast bpduguard default");
    body.push("spanning-tree extend system-id");
    const byPriority = new Map<number, number[]>();
    for (const [v, p] of dev.stp.priorities) byPriority.set(p, [...(byPriority.get(p) ?? []), v]);
    for (const [p, vlans] of byPriority) body.push(`spanning-tree vlan ${formatVlanList(vlans)} priority ${p}`);
    body.push("!");
    if (dev.vtp.mode === "transparent" || dev.vtp.mode === "off") {
      if (dev.vtp.domain) body.push(`vtp domain ${dev.vtp.domain}`);
      body.push(`vtp mode ${dev.vtp.mode}`);
      body.push("!");
      for (const v of [...dev.vlans.values()].sort((a, b) => a.id - b.id)) {
        if (v.id === 1 || (v.id >= 1002 && v.id <= 1005)) continue;
        body.push(`vlan ${v.id}`);
        if (v.name !== `VLAN${String(v.id).padStart(4, "0")}`) body.push(` name ${v.name}`);
        body.push("!");
      }
    }
    body.push("vlan internal allocation policy ascending", "!");
  }
  for (const c of dev.errdisableRecovery.causes) body.push(`errdisable recovery cause ${c}`);
  if (dev.errdisableRecovery.interval !== 300) body.push(`errdisable recovery interval ${dev.errdisableRecovery.interval}`);
  if (dev.macAgingTime !== 300) body.push(`mac address-table aging-time ${dev.macAgingTime}`);
  for (const e of dev.macTable.filter((m) => m.type === "STATIC")) {
    body.push(`mac address-table static ${e.mac} vlan ${e.vlan} interface ${e.port}`);
  }
  if (!dev.cdpRun) body.push("no cdp run");
  if (dev.lldpRun) body.push("lldp run");
  body.push("!");

  for (const i of dev.interfaces) body.push(...interfaceConfig(dev, i), "!");

  if (dev.defaultGateway) body.push(`ip default-gateway ${dev.defaultGateway}`);
  body.push("ip http server", "ip http secure-server");
  for (const r of dev.staticRoutes) body.push(`ip route ${r.network} ${r.mask} ${r.nextHop}`);
  if (dev.ssh.version !== null) body.push(`ip ssh version ${dev.ssh.version}`);
  if (dev.ssh.timeout !== 120) body.push(`ip ssh time-out ${dev.ssh.timeout}`);
  if (dev.ssh.retries !== 3) body.push(`ip ssh authentication-retries ${dev.ssh.retries}`);
  body.push("!");
  for (const h of dev.loggingHosts) body.push(`logging host ${h}`);
  for (const b of ["motd", "login", "exec"] as const) {
    const text = dev.banners[b];
    if (text !== undefined) body.push(`banner ${b} ^C`, ...text.split("\n"), "^C");
  }
  body.push("!", "line con 0", ...lineBody(dev, dev.lines.console, false), ...vtyBlocks(dev), "!");
  for (const s of dev.ntpServers) body.push(`ntp server ${s}`);
  body.push("end");

  const bytes = body.join("\n").length;
  return ["Building configuration...", "", `Current configuration : ${bytes} bytes`, ...body];
}

export function interfaceRunningConfig(dev: DeviceState, i: InterfaceState): string[] {
  const block = interfaceConfig(dev, i);
  return ["Building configuration...", "", `Current configuration : ${block.join("\n").length} bytes`, "!", ...block, "end"];
}

