/**
 * IOS command set, registered per mode into a CommandTree. Each device kind
 * gets its own tree so that e.g. `vlan` simply does not exist on a router,
 * exactly like on real hardware.
 */
import { INTERFACE_TYPES } from "../device";
import { CommandTree, P, type Node } from "../grammar";
import type { CliMode, IosDeviceKind } from "../types";
import { registerExec } from "./exec";
import { registerGlobal } from "./global";
import { CONFIG_MODES, SUB_MODES } from "./helpers";
import { registerInterface } from "./interface";
import { registerLine, registerVlanMode } from "./line";

const KEYWORD_HELP: Record<string, string> = {
  access: "Set access mode characteristics of the interface",
  "address-table": "MAC forwarding table",
  address: "Set the IP address of an interface",
  "aging-time": "Set MAC address table entry maximum age",
  all: "All",
  allowed: "Set allowed VLAN characteristics when interface is in trunking mode",
  arp: "ARP table",
  "arp-cache": "Clear the entire ARP cache",
  "authentication-retries": "Specify number of authentication retries",
  banner: "Define a login banner",
  bpduguard: "Don't accept BPDUs on this interface",
  brief: "Brief summary",
  cdp: "CDP information",
  "channel-group": "Etherchannel/port bundling configuration",
  clear: "Reset functions",
  clock: "Manage the system clock",
  configure: "Enter configuration mode",
  copy: "Copy from one file to another",
  cost: "Change an interface's spanning tree port path cost",
  count: "Count of mac address table entries",
  counters: "Clear counters on one or all interfaces",
  crypto: "Encryption module",
  default: "Set a command to its defaults",
  "default-gateway": "Specify default gateway (if not routing IP)",
  delete: "Delete a file",
  description: "Interface specific description",
  detail: "Show detailed information",
  dhcp: "DHCP configuration",
  dir: "List files on a filesystem",
  disable: "Turn off privileged commands",
  do: "To run exec commands in config mode",
  domain: "IP DNS Resolver",
  "domain-lookup": "Enable IP Domain Name System hostname translation",
  "domain-name": "Define the default domain name",
  duplex: "Configure duplex operation.",
  dynamic: "Set trunking mode to dynamically negotiate access or trunk mode",
  enable: "Turn on privileged commands",
  encapsulation: "Set trunking encapsulation when interface is in trunking mode",
  end: "Exit from configure mode",
  erase: "Erase a filesystem",
  errdisable: "Error disable",
  etherchannel: "EtherChannel information",
  "exec-timeout": "Set the EXEC timeout",
  exit: "Exit from the EXEC",
  flash: "display information about flash: file system",
  "flash:": "display information about flash: file system",
  "flash:vlan.dat": "Delete the VLAN database",
  "general-keys": "Generate a general purpose RSA key pair for signing and encryption",
  generate: "Generate new keys",
  "helper-address": "Specify a destination address for UDP broadcasts",
  history: "Display the session command history",
  hostname: "Set system's network name",
  interface: "Select an interface to configure",
  interfaces: "Interface status and configuration",
  ip: "Global IP configuration subcommands",
  key: "Long term key operations",
  lldp: "Global LLDP configuration",
  line: "Configure a terminal line",
  logging: "Modify message logging facilities",
  login: "Enable password checking",
  logout: "Exit from the EXEC",
  mac: "MAC configuration",
  "mac-address": "Secure mac address",
  maximum: "Max secure addresses",
  memory: "Write to NV memory",
  mode: "Set trunking mode of the interface",
  modulus: "Provide number of modulus bits on the command line",
  monitor: "Copy debug output to the current terminal line",
  name: "Ascii name of the VLAN",
  "name-server": "Specify address of name server to use",
  native: "Set native VLAN when interface is in trunking mode",
  neighbors: "CDP neighbor entries",
  no: "Negate a command or set its defaults",
  nonegotiate: "Device will not engage in negotiation protocol on this interface",
  ntp: "Configure NTP",
  password: "Set a password",
  ping: "Send echo messages",
  "port-priority": "Change an interface's spanning tree port priority",
  "port-security": "Security related command",
  portfast: "Portfast options for the interface",
  priority: "Set the bridge priority for the spanning tree",
  privilege: "Set user privilege level",
  range: "interface range command",
  reload: "Halt and perform a cold restart",
  root: "Configure switch as root",
  route: "IP routing table",
  routing: "Enable IP routing",
  rsa: "Generate RSA keys",
  "running-config": "Current operating configuration",
  secret: "Assign the privileged level secret",
  service: "Modify use of network based services",
  "password-encryption": "Encrypt system passwords",
  show: "Show running system information",
  shutdown: "Shutdown the selected interface",
  snooping: "DHCP Snooping",
  "spanning-tree": "Spanning Tree Subsystem",
  speed: "Configure speed operation.",
  ssh: "Configure secure shell",
  "startup-config": "Contents of startup configuration",
  static: "static keyword",
  status: "Show interface line status",
  sticky: "Configure dynamic secure addresses as sticky",
  summary: "Summary of port states",
  switchport: "Set switching mode characteristics",
  telnet: "Open a telnet connection",
  terminal: "Configure from the terminal",
  "time-out": "Specify connection timeout",
  traceroute: "Trace route to destination",
  transport: "Define transport protocols for line",
  trunk: "Set trunking characteristics of the interface",
  username: "Establish User Name Authentication",
  users: "Display information about terminal lines",
  version: "System hardware and software status",
  violation: "Security violation mode",
  vlan: "VLAN commands",
  voice: "Voice appliance attributes",
  vtp: "Configure global VTP state",
  write: "Write running configuration to memory, network, or terminal",
  zeroize: "Remove keys",
};

export function buildCommandTree(kind: IosDeviceKind): CommandTree {
  const t = new CommandTree(KEYWORD_HELP);
  registerExec(t, kind);
  registerGlobal(t, kind);
  registerInterface(t, kind);
  registerLine(t);
  if (kind !== "router") registerVlanMode(t);

  // Available in every configuration mode.
  t.add(CONFIG_MODES, "end", (ctx) => {
    ctx.session.exitSubMode("privileged");
    ctx.print("", "%SYS-5-CONFIG_I: Configured from console by console");
  });
  t.add(CONFIG_MODES, "do $command", () => {
    /* Executed by CliSession, registered here for `?` help only. */
  }, { params: { command: P.line("Exec Command") } });
  t.add("config", "exit", (ctx) => {
    ctx.session.exitSubMode("privileged");
    ctx.print("", "%SYS-5-CONFIG_I: Configured from console by console");
  }, { help: { exit: "Exit from configure mode" } });
  t.add(SUB_MODES, "exit", (ctx) => ctx.session.exitSubMode("config"), {
    help: { exit: "Exit from the current configuration sub-mode" },
  });
  return t;
}

const cache = new Map<IosDeviceKind, CommandTree>();

export function commandTreeFor(kind: IosDeviceKind): CommandTree {
  let tree = cache.get(kind);
  if (!tree) {
    tree = buildCommandTree(kind);
    cache.set(kind, tree);
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Catalog (for documentation pages): every command reachable in a mode.
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  syntax: string;
  help: string;
}

const IF_TYPE_NAMES = new Set(Object.keys(INTERFACE_TYPES));
/** Prefix words whose help says little about the command itself. */
const GENERIC = new Set(["show", "no", "clear", "do", "ip", "switchport", "spanning-tree", "default"]);

export function commandCatalog(kind: IosDeviceKind, mode: CliMode): CatalogEntry[] {
  const out = new Map<string, CatalogEntry>();
  const walk = (node: Node, words: string[], help: string) => {
    for (const child of node.children) {
      const tok = child.token!;
      if (tok.type === "param" && tok.spec.hidden) continue;
      let word: string;
      let nextHelp = help;
      let next = child;
      if (tok.type === "keyword" && IF_TYPE_NAMES.has(tok.word)) {
        // "FastEthernet <0-9>" etc. are collapsed into "<interface>".
        const num = child.children.find((c) => c.token!.type === "param");
        if (!num) continue;
        word = "<interface>";
        next = num;
      } else if (tok.type === "keyword") {
        word = tok.word;
        // Describe the command by its first meaningful keyword.
        const generic = words.every((w) => GENERIC.has(w));
        if (words.length === 0 || (generic && !GENERIC.has(tok.word) && tok.help)) nextHelp = tok.help;
      } else {
        word = tok.spec.label.startsWith("<") ? tok.spec.label : `<${tok.spec.label}>`;
      }
      const syntax = [...words, word];
      if (next.handler) {
        const key = syntax.join(" ");
        if (!out.has(key)) out.set(key, { syntax: key, help: nextHelp });
      }
      walk(next, syntax, nextHelp);
    }
  };
  walk(commandTreeFor(kind).root(mode), [], "");
  return [...out.values()].sort((a, b) => a.syntax.localeCompare(b.syntax));
}
