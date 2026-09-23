/** show clock / users / flash / ip ssh / logging / arp / privilege ... */
import { interfaceStatus, shortInterfaceName } from "../device";
import type { DeviceState } from "../types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatClock(d: Date, synced: boolean): string {
  const t = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}.${String(d.getUTCMilliseconds()).padStart(3, "0")}`;
  return `${synced ? "" : "*"}${t} UTC ${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

export function parseMonth(s: string): number | null {
  const i = MONTHS.findIndex((m) => s.toLowerCase().startsWith(m.toLowerCase()));
  return i === -1 ? null : i;
}

export function showUsers(): string[] {
  return [
    "    Line       User       Host(s)              Idle       Location",
    "*  0 con 0                idle                 00:00:00",
    "",
    "  Interface    User               Mode         Idle     Peer Address",
  ];
}

export function showFlash(dev: DeviceState): string[] {
  const image = dev.kind === "router" ? "isr4300-universalk9.16.09.04.SPA.bin" : dev.kind === "switch-l3" ? "c3560-ipservicesk9-mz.150-2.SE4.bin" : "c2960-lanbasek9-mz.150-2.SE4.bin";
  const files: Array<[string, number]> = [[image, 4670455]];
  if (dev.startupConfig) files.push(["config.text", dev.startupConfig.join("\n").length]);
  if (dev.vlanDat) files.push(["vlan.dat", 616]);
  const used = files.reduce((s, [, n]) => s + n, 0);
  return [
    "Directory of flash:/",
    "",
    ...files.map(([name, size], i) => `${String(i + 2).padStart(5)}  -rw-  ${String(size).padStart(10)}          <no date>  ${name}`),
    "",
    `64016384 bytes total (${64016384 - used} bytes free)`,
  ];
}

export function showIpSsh(dev: DeviceState): string[] {
  if (!dev.ssh.rsaBits) {
    return [
      "SSH Disabled - version 1.99",
      "%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).",
      `Authentication timeout: ${dev.ssh.timeout} secs; Authentication retries: ${dev.ssh.retries}`,
    ];
  }
  const v = dev.ssh.version === 2 ? "2.0" : dev.ssh.version === 1 ? "1.5" : "1.99";
  return [`SSH Enabled - version ${v}`, `Authentication timeout: ${dev.ssh.timeout} secs; Authentication retries: ${dev.ssh.retries}`, `Minimum expected Diffie Hellman key size : 1024 bits`, `IOS Keys in SECSH format(ssh-rsa, base64 encoded): ${dev.hostname}.${dev.domainName}`];
}

export function showLogging(dev: DeviceState): string[] {
  return [
    "Syslog logging: enabled (0 messages dropped, 0 messages rate-limited, 0 flushes, 0 overruns, xml disabled, filtering disabled)",
    "",
    "    Console logging: level debugging, 0 messages logged, xml disabled,",
    "    Monitor logging: level debugging, 0 messages logged, xml disabled,",
    "    Buffer logging:  level debugging, 0 messages logged, xml disabled,",
    `    Trap logging: level informational, 0 message lines logged`,
    ...dev.loggingHosts.map((h) => `        Logging to ${h}  (udp port 514, audit disabled, link up), 0 message lines logged`),
  ];
}

export function showArp(dev: DeviceState): string[] {
  const out = ["Protocol  Address          Age (min)  Hardware Addr   Type   Interface"];
  for (const i of dev.interfaces) {
    if (!i.ipv4 || interfaceStatus(dev, i).protocol !== "up") continue;
    out.push(`Internet  ${i.ipv4.address.padEnd(17)}${"-".padStart(9)}  ${i.mac.padEnd(16)}ARPA   ${i.name}`);
  }
  return out;
}

export function showErrdisableRecovery(dev: DeviceState): string[] {
  const causes = ["bpduguard", "psecure-violation", "link-flap", "udld", "security-violation"];
  const out = ["ErrDisable Reason            Timer Status", "-----------------            --------------"];
  for (const c of causes) out.push(`${c.padEnd(29)}${dev.errdisableRecovery.causes.includes(c) ? "Enabled" : "Disabled"}`);
  out.push("", `Timer interval: ${dev.errdisableRecovery.interval} seconds`, "", "Interfaces that will be enabled at the next timeout:", "");
  for (const i of dev.interfaces) {
    if (i.errDisabled && dev.errdisableRecovery.causes.includes(i.errDisabled)) {
      out.push(`${shortInterfaceName(i).padEnd(14)}${i.errDisabled.padEnd(20)}${dev.errdisableRecovery.interval}`);
    }
  }
  return out;
}

export function showDhcpSnooping(dev: DeviceState): string[] {
  const out = [
    `Switch DHCP snooping is ${dev.dhcpSnooping.enabled ? "enabled" : "disabled"}`,
    "DHCP snooping is configured on following VLANs:",
    dev.dhcpSnooping.vlans.join(",") || "none",
    "Insertion of option 82 is enabled",
    "Interface                  Trusted    Allow option    Rate limit (pps)",
    "-----------------------    -------    ------------    ----------------",
  ];
  for (const i of dev.interfaces) if (i.dhcpSnoopingTrust) out.push(`${i.name.padEnd(27)}yes        yes             unlimited`);
  return out;
}
