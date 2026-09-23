import { INTERFACE_TYPES, addVirtualInterface, findInterface, isVirtual, parseInterfaceName, shortInterfaceName } from "../device";
import type { Args, CommandTree, Handler, ParamSpec } from "../grammar";
import { P } from "../grammar";
import type { CommandContext } from "../session";
import type { CliMode, DeviceState, InterfaceState, InterfaceType, IosDeviceKind } from "../types";

export const CONFIG_MODES: CliMode[] = ["config", "config-if", "config-if-range", "config-vlan", "config-line"];
export const SUB_MODES: CliMode[] = ["config-if", "config-if-range", "config-vlan", "config-line"];
export const IF_MODES: CliMode[] = ["config-if", "config-if-range"];
export const EXEC: CliMode[] = ["user", "privileged"];

export const IF_NUMBER_LABEL: Record<InterfaceType, [string, string]> = {
  FastEthernet: ["<0-9>", "FastEthernet interface number"],
  GigabitEthernet: ["<0-9>", "GigabitEthernet interface number"],
  Loopback: ["<0-2147483647>", "Loopback interface number"],
  "Port-channel": ["<1-48>", "Port-channel interface number"],
  Vlan: ["<1-4094>", "Vlan interface number"],
};

export function interfaceTypes(kind: IosDeviceKind): InterfaceType[] {
  return (Object.keys(INTERFACE_TYPES) as InterfaceType[]).filter((t) =>
    t === "FastEthernet" || t === "Vlan" || t === "Port-channel" ? kind !== "router" : true,
  );
}

/**
 * Registers `<prefix> <iface> <suffix>` in both IOS spellings: "g0/1"
 * (single token) and "GigabitEthernet 0/1" (type keyword + number).
 */
export function addIfCommand(
  t: CommandTree,
  kind: IosDeviceKind,
  modes: CliMode | CliMode[],
  prefix: string,
  suffix: string,
  handler: (ctx: CommandContext, iface: InterfaceState, args: Args) => void,
  opts: { params?: Record<string, ParamSpec>; help?: Record<string, string> } = {},
): void {
  const run: Handler = (ctx, args) => {
    const iface = args.ifname
      ? findInterface(ctx.device, args.ifname)
      : ctx.device.interfaces.find((i) => i.type === args.iftype && i.number === args.ifnum);
    if (!iface) {
      ctx.print("% Invalid input detected: no such interface");
      return;
    }
    handler(ctx, iface, args);
  };
  const tail = suffix ? ` ${suffix}` : "";
  t.add(modes, `${prefix} $ifname${tail}`, run, { ...opts, params: { ...opts.params, ifname: P.ifName() } });
  for (const type of interfaceTypes(kind)) {
    const [label, help] = IF_NUMBER_LABEL[type];
    t.add(
      modes,
      `${prefix} ${type} $ifnum${tail}`,
      (ctx, args) => run(ctx, { ...args, iftype: type }),
      {
        ...opts,
        params: { ...opts.params, ifnum: P.ifNumber(label, help) },
        help: { ...opts.help, [type]: INTERFACE_TYPES[type].help },
      },
    );
  }
}

/** Runs `fn` on every interface being configured (config-if / range). */
export function eachInterface(fn: (ctx: CommandContext, iface: InterfaceState, args: Args) => void): Handler {
  return (ctx, args) => {
    for (const iface of ctx.session.currentInterfaces) fn(ctx, iface, args);
  };
}

/**
 * Like eachInterface, for switchport commands: rejects virtual / routed
 * ports and propagates port-channel settings to its members.
 */
export function eachSwitchport(fn: (ctx: CommandContext, iface: InterfaceState, args: Args) => void): Handler {
  return eachInterface((ctx, iface, args) => {
    if (isVirtual(iface)) {
      ctx.print("% Invalid input detected: not a switchport");
      return;
    }
    if (!iface.switchport) {
      ctx.print(`% Command rejected: ${iface.name} is not a switching port.`);
      return;
    }
    fn(ctx, iface, args);
    if (iface.type === "Port-channel") {
      for (const m of ctx.device.interfaces) {
        if (m.channelGroup?.id === Number(iface.number) && m.switchport) fn({ ...ctx, print: () => {} }, m, args);
      }
    }
  });
}

/** VLAN database changed: bump the VTP revision in server mode. */
export function vlanDbChanged(dev: DeviceState): void {
  if (dev.vtp.mode === "server") dev.vtp.revision++;
}

export function vtpClientRejects(ctx: CommandContext): boolean {
  if (ctx.device.vtp.mode === "client") {
    ctx.print("VTP VLAN configuration not allowed when device is in CLIENT mode.");
    return true;
  }
  return false;
}

export function ensureVlan(dev: DeviceState, id: number): void {
  if (!dev.vlans.has(id)) {
    dev.vlans.set(id, { id, name: `VLAN${String(id).padStart(4, "0")}` });
    vlanDbChanged(dev);
  }
}

/** Looks up or creates (virtual types only) the interface to configure. */
export function resolveOrCreate(dev: DeviceState, type: InterfaceType, number: string): InterfaceState | string {
  const existing = dev.interfaces.find((i) => i.type === type && i.number === number);
  if (existing) return existing;
  const n = Number(number);
  const creatable =
    (type === "Loopback" && /^\d+$/.test(number) && n <= 2147483647) ||
    (type === "Vlan" && /^\d+$/.test(number) && n >= 1 && n <= 4094) ||
    (type === "Port-channel" && /^\d+$/.test(number) && n >= 1 && n <= 48);
  if (!creatable) return "%Invalid interface type and number";
  return addVirtualInterface(dev, type, String(n));
}

/**
 * Parses an `interface range` spec: "fa0/1 - 12, gi0/1 - 2", "f0/1-4",
 * "vlan 10 - 20". Returns the interfaces or an error message.
 */
export function parseRange(dev: DeviceState, spec: string): InterfaceState[] | string {
  const out: InterfaceState[] = [];
  for (const raw of spec.split(",")) {
    const part = raw.replace(/\s+/g, "");
    const m = /^([a-z-]+)((?:\d+\/)*)(\d+)(?:-(\d+))?$/i.exec(part);
    const parsed = m && parseInterfaceName(`${m[1]}${m[2]}${m[3]}`);
    if (!m || !parsed) return "% Command rejected: invalid interface range";
    const from = Number(m[3]);
    const to = m[4] === undefined ? from : Number(m[4]);
    if (to < from) return "% Command rejected: invalid interface range";
    for (let n = from; n <= to; n++) {
      const found = resolveOrCreate(dev, parsed.type, `${m[2]}${n}`);
      if (typeof found === "string") return "% Command rejected: range contains an invalid interface";
      out.push(found);
    }
  }
  return out;
}

export function names(ifaces: InterfaceState[]): string {
  return ifaces.map(shortInterfaceName).join(", ");
}

/** "enable secret 9 $9$..." / "password 7 0822..." / "password cisco". */
export function splitTypedSecret(text: string): { type: number | null; value: string } {
  const m = /^(0|5|7|8|9)\s+(\S+)$/.exec(text.trim());
  return m ? { type: Number(m[1]), value: m[2]! } : { type: null, value: text.trim() };
}
