/**
 * IOS command set, registered per mode into a CommandTree. Each device kind
 * gets its own tree so that e.g. `vlan` simply does not exist on a router,
 * exactly like on real hardware.
 */
import { INTERFACE_TYPES, isVirtual, parseInterfaceName } from "./device";
import { CommandTree, P, type Args } from "./grammar";
import { maskToPrefix, networkOf, parseIpv4 } from "./net";
import type { CommandContext } from "./session";
import {
  runningConfig,
  showIpInterfaceBrief,
  showIpRoute,
  showMacAddressTable,
  showVersion,
  showVlanBrief,
} from "./show";
import type { CliMode, InterfaceState, InterfaceType, IosDeviceKind } from "./types";

const KEYWORD_HELP: Record<string, string> = {
  access: "Set access mode characteristics of the interface",
  address: "Set the IP address of an interface",
  brief: "Brief summary",
  configure: "Enter configuration mode",
  "address-table": "MAC forwarding table",
  description: "Interface specific description",
  disable: "Turn off privileged commands",
  do: "To run exec commands in config mode",
  enable: "Turn on privileged commands",
  end: "Exit from configure mode",
  exit: "Exit from the EXEC",
  history: "Display the session command history",
  hostname: "Set system's network name",
  interface: "Select an interface to configure",
  ip: "IP information",
  logout: "Exit from the EXEC",
  mac: "MAC configuration",
  memory: "Write to NV memory",
  mode: "Set trunking mode of the interface",
  name: "Ascii name of the VLAN",
  no: "Negate a command or set its defaults",
  route: "IP routing table",
  "running-config": "Current operating configuration",
  show: "Show running system information",
  shutdown: "Shutdown the selected interface",
  "startup-config": "Contents of startup configuration",
  switchport: "Set switching mode characteristics",
  terminal: "Configure from the terminal",
  trunk: "Set trunking mode to TRUNK unconditionally",
  version: "System hardware and software status",
  vlan: "VTP VLAN status",
  write: "Write running configuration to memory, network, or terminal",
};

const CONFIG_MODES: CliMode[] = ["config", "config-if", "config-vlan"];
const SUB_MODES: CliMode[] = ["config-if", "config-vlan"];

const IF_NUMBER_LABEL: Record<InterfaceType, [string, string]> = {
  FastEthernet: ["<0-9>", "FastEthernet interface number"],
  GigabitEthernet: ["<0-9>", "GigabitEthernet interface number"],
  Loopback: ["<0-2147483647>", "Loopback interface number"],
  Vlan: ["<1-4094>", "Vlan interface number"],
};

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

// ---------------------------------------------------------------------------
// Handlers shared by several patterns
// ---------------------------------------------------------------------------

function enterInterface(ctx: CommandContext, type: InterfaceType, number: string): void {
  const dev = ctx.device;
  let iface = dev.interfaces.find((i) => i.type === type && i.number === number);
  if (!iface) {
    const n = Number(number);
    const creatable =
      (type === "Loopback" && /^\d+$/.test(number) && n <= 2147483647) ||
      (type === "Vlan" && /^\d+$/.test(number) && n >= 1 && n <= 4094);
    if (!creatable) {
      ctx.print("%Invalid interface type and number");
      return;
    }
    iface = { name: `${type}${n}`, type, number: String(n), adminUp: true, carrier: false, switchport: null };
    dev.interfaces.push(iface);
  }
  ctx.session.currentInterface = iface;
  ctx.session.mode = "config-if";
}

function withInterface(fn: (ctx: CommandContext, iface: InterfaceState, args: Args) => void) {
  return (ctx: CommandContext, args: Args) => {
    const iface = ctx.session.currentInterface;
    if (iface) fn(ctx, iface, args);
  };
}

function withSwitchport(fn: (ctx: CommandContext, iface: InterfaceState, args: Args) => void) {
  return withInterface((ctx, iface, args) => {
    if (isVirtual(iface)) {
      ctx.print("% Command not supported on this interface");
      return;
    }
    if (!iface.switchport) {
      ctx.print(`% ${iface.name} is a routed port. Use 'switchport' first.`);
      return;
    }
    fn(ctx, iface, args);
  });
}

function exitToPrivileged(ctx: CommandContext): void {
  ctx.session.mode = "privileged";
  ctx.session.currentInterface = null;
  ctx.session.currentVlan = null;
  ctx.print("", "%SYS-5-CONFIG_I: Configured from console by console");
}

function logout(ctx: CommandContext): void {
  ctx.session.mode = "user";
  ctx.print("", "", `${ctx.device.hostname} con0 is now available`, "", "", "Press RETURN to get started.", "");
}

function ensureVlan(ctx: CommandContext, id: number): void {
  if (!ctx.device.vlans.has(id)) ctx.device.vlans.set(id, { id, name: `VLAN${pad4(id)}` });
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

export function buildCommandTree(kind: IosDeviceKind): CommandTree {
  const t = new CommandTree(KEYWORD_HELP);
  const isSwitch = kind !== "router";
  const routes = kind !== "switch-l2";

  // ----- EXEC (user + privileged) -----
  t.add("user", "enable", (ctx) => {
    ctx.session.mode = "privileged";
  });
  t.add("privileged", "disable", (ctx) => {
    ctx.session.mode = "user";
  });
  t.add(["user", "privileged"], "exit", logout);
  t.add(["user", "privileged"], "logout", logout);
  t.add("privileged", "configure terminal", (ctx) => {
    ctx.session.mode = "config";
    ctx.print("Enter configuration commands, one per line.  End with CNTL/Z.");
  });

  const exec: CliMode[] = ["user", "privileged"];
  t.add(exec, "show version", (ctx) => ctx.print(...showVersion(ctx.device, ctx.session.uptime())));
  t.add(exec, "show history", (ctx) => ctx.print(...ctx.session.history.map((h) => `  ${h}`)));
  t.add(exec, "show ip interface brief", (ctx) => ctx.print(...showIpInterfaceBrief(ctx.device)), {
    help: { interface: "IP interface status and configuration", brief: "Brief summary of IP status and configuration" },
  });
  if (routes) t.add(exec, "show ip route", (ctx) => ctx.print(...showIpRoute(ctx.device)));
  if (isSwitch) {
    t.add(exec, "show vlan brief", (ctx) => ctx.print(...showVlanBrief(ctx.device)), {
      help: { brief: "VTP all VLAN status in brief" },
    });
    t.add(exec, "show mac address-table", (ctx) => ctx.print(...showMacAddressTable(ctx.device)));
  }
  t.add("privileged", "show running-config", (ctx) => ctx.print(...runningConfig(ctx.device)));
  t.add("privileged", "show startup-config", (ctx) => {
    const cfg = ctx.device.startupConfig;
    if (!cfg) ctx.print("startup-config is not present");
    else ctx.print(`Using ${cfg.join("\n").length} bytes`, ...cfg);
  });
  t.add("privileged", "write memory", (ctx) => {
    ctx.device.startupConfig = runningConfig(ctx.device).slice(2);
    ctx.print("Building configuration...", "[OK]");
  });

  // ----- Every config mode -----
  t.add(CONFIG_MODES, "end", exitToPrivileged);
  t.add(CONFIG_MODES, "do $command", () => {
    /* Executed by CliSession, registered here for `?` help only. */
  }, { params: { command: P.line("Exec Command") } });
  t.add("config", "exit", exitToPrivileged, { help: { exit: "Exit from configure mode" } });
  t.add(SUB_MODES, "exit", (ctx) => {
    ctx.session.mode = "config";
    ctx.session.currentInterface = null;
    ctx.session.currentVlan = null;
  }, { help: { exit: "Exit from interface configuration mode" } });

  // ----- Global config -----
  t.add("config", "hostname $name", (ctx, { name }) => {
    if (!/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(name!)) {
      ctx.print("% Hostname contains one or more illegal characters.");
      return;
    }
    ctx.device.hostname = name!;
  }, { params: { name: P.word("This system's network name") } });

  const ifTypes = (Object.keys(INTERFACE_TYPES) as InterfaceType[]).filter((type) =>
    type === "FastEthernet" || type === "Vlan" ? isSwitch : true,
  );
  for (const type of ifTypes) {
    const [label, help] = IF_NUMBER_LABEL[type];
    t.add("config", `interface ${type} $number`, (ctx, { number }) => enterInterface(ctx, type, number!), {
      params: { number: P.ifNumber(label, help) },
      help: { [type]: INTERFACE_TYPES[type].help },
    });
  }
  // Shorthand "interface g0/1" as a single token.
  t.add("config", "interface $ifname", (ctx, { ifname }) => {
    const parsed = parseInterfaceName(ifname!);
    if (!parsed || !ifTypes.includes(parsed.type)) {
      ctx.print("%Invalid interface type and number");
      return;
    }
    enterInterface(ctx, parsed.type, parsed.number);
  }, { params: { ifname: P.ifName() } });

  if (routes) {
    const routeParams = {
      params: {
        network: P.ipv4("Destination prefix"),
        mask: P.mask("Destination prefix mask"),
        nextHop: P.ipv4("Forwarding router's address"),
      },
      help: { ip: "Global IP configuration subcommands", route: "Establish static routes" },
    };
    t.add("config", "ip route $network $mask $nextHop", (ctx, { network, mask, nextHop }) => {
      if (networkOf(network!, mask!) !== network) {
        ctx.print("%Inconsistent address and mask");
        return;
      }
      const exists = ctx.device.staticRoutes.some(
        (r) => r.network === network && r.mask === mask && r.nextHop === nextHop,
      );
      if (!exists) ctx.device.staticRoutes.push({ network: network!, mask: mask!, nextHop: nextHop! });
    }, routeParams);
    t.add("config", "no ip route $network $mask $nextHop", (ctx, { network, mask, nextHop }) => {
      ctx.device.staticRoutes = ctx.device.staticRoutes.filter(
        (r) => !(r.network === network && r.mask === mask && r.nextHop === nextHop),
      );
    }, routeParams);
  }

  if (isSwitch) {
    const vlanParams = { params: { id: P.number(1, 4094, "ISL VLAN IDs 1-1005") }, help: { vlan: "Vlan commands" } };
    t.add("config", "vlan $id", (ctx, { id }) => {
      const n = Number(id);
      ensureVlan(ctx, n);
      ctx.session.currentVlan = n;
      ctx.session.mode = "config-vlan";
    }, vlanParams);
    t.add("config", "no vlan $id", (ctx, { id }) => {
      const n = Number(id);
      if (n === 1) {
        ctx.print("%Default VLAN 1 may not be deleted.");
        return;
      }
      ctx.device.vlans.delete(n);
    }, vlanParams);

    t.add("config-vlan", "name $name", (ctx, { name }) => {
      const id = ctx.session.currentVlan;
      if (id === null) return;
      if (id === 1) {
        ctx.print("Default VLAN 1 may not have its name changed.");
        return;
      }
      ctx.device.vlans.get(id)!.name = name!.slice(0, 32);
    }, { params: { name: P.word("The ascii name for the VLAN") } });
  }

  // ----- Interface config -----
  const ipAddrOpts = {
    params: { ip: P.ipv4("IP address"), mask: P.mask() },
    help: { ip: "Interface Internet Protocol config commands" },
  };
  t.add("config-if", "ip address $ip $mask", withInterface((ctx, iface, { ip, mask }) => {
    if (iface.switchport) {
      ctx.print("% IP addresses may not be configured on L2 links.");
      return;
    }
    const len = maskToPrefix(mask!)!;
    const net = networkOf(ip!, mask!);
    const broadcast = (parseIpv4(net)! | (~parseIpv4(mask!)! >>> 0)) >>> 0;
    if (len < 31 && (ip === net || parseIpv4(ip!) === broadcast)) {
      ctx.print(`Bad mask /${len} for address ${ip}`);
      return;
    }
    for (const other of ctx.device.interfaces) {
      if (other === iface || !other.ipv4) continue;
      const shortest = maskToPrefix(other.ipv4.mask)! < len ? other.ipv4.mask : mask!;
      if (networkOf(other.ipv4.address, shortest) === networkOf(ip!, shortest)) {
        ctx.print(`% ${net} overlaps with ${other.name}`);
        return;
      }
    }
    iface.ipv4 = { address: ip!, mask: mask! };
  }), ipAddrOpts);
  t.add("config-if", "no ip address", withInterface((_ctx, iface) => {
    delete iface.ipv4;
  }), ipAddrOpts);

  t.add("config-if", "shutdown", withInterface((_ctx, iface) => {
    iface.adminUp = false;
  }));
  t.add("config-if", "no shutdown", withInterface((_ctx, iface) => {
    iface.adminUp = true;
  }));

  const descOpts = { params: { text: P.line("Up to 240 characters describing this interface") } };
  t.add("config-if", "description $text", withInterface((_ctx, iface, { text }) => {
    iface.description = text!.slice(0, 240);
  }), descOpts);
  t.add("config-if", "no description", withInterface((_ctx, iface) => {
    delete iface.description;
  }));

  if (isSwitch) {
    t.add("config-if", "switchport mode access", withSwitchport((_ctx, iface) => {
      iface.switchport!.mode = "access";
    }), { help: { access: "Set trunking mode to ACCESS unconditionally" } });
    t.add("config-if", "switchport mode trunk", withSwitchport((_ctx, iface) => {
      iface.switchport!.mode = "trunk";
    }));
    t.add("config-if", "switchport access vlan $id", withSwitchport((ctx, iface, { id }) => {
      const n = Number(id);
      if (!ctx.device.vlans.has(n)) {
        ctx.print(`% Access VLAN does not exist. Creating vlan ${n}`);
        ensureVlan(ctx, n);
      }
      iface.switchport!.accessVlan = n;
    }), { params: { id: P.number(1, 4094, "VLAN ID of the VLAN when this port is in access mode") } });
  }

  if (kind === "switch-l3") {
    t.add("config-if", "no switchport", withInterface((ctx, iface) => {
      if (isVirtual(iface)) {
        ctx.print("% Command not supported on this interface");
        return;
      }
      iface.switchport = null;
    }));
    t.add("config-if", "switchport", withInterface((ctx, iface) => {
      if (isVirtual(iface)) {
        ctx.print("% Command not supported on this interface");
        return;
      }
      if (!iface.switchport) {
        delete iface.ipv4;
        iface.switchport = { mode: "access", accessVlan: 1 };
      }
    }));
  }

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
