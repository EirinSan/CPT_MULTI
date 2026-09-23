/** Interface configuration: (config-if)# and (config-if-range)# */
import { addVirtualInterface, defaultSwitchport, isPhysical, isVirtual, shortInterfaceName } from "../device";
import { P, type CommandTree } from "../grammar";
import { maskToPrefix, networkOf, parseIpv4, parseMac, parseVlanList } from "../net";
import type { ChannelMode, IosDeviceKind, PortSecurityViolation, SwitchportConfig, SwitchportMode } from "../types";
import { IF_MODES, eachInterface, eachSwitchport, ensureVlan } from "./helpers";

function cloneSwitchport(sp: SwitchportConfig): SwitchportConfig {
  return { ...sp, allowedVlans: sp.allowedVlans === "all" ? "all" : [...sp.allowedVlans] };
}

export function registerInterface(t: CommandTree, kind: IosDeviceKind): void {
  const isSwitch = kind !== "router";

  // ----- Generic -----
  t.add(IF_MODES, "description $text", eachInterface((_ctx, i, { text }) => {
    i.description = text!.slice(0, 240);
  }), { params: { text: P.line("Up to 240 characters describing this interface") } });
  t.add(IF_MODES, "no description", eachInterface((_ctx, i) => {
    delete i.description;
  }));
  t.add(IF_MODES, "shutdown", eachInterface((_ctx, i) => {
    i.adminUp = false;
    // shutdown / no shutdown is how an err-disabled port is recovered.
    i.errDisabled = null;
  }));
  t.add(IF_MODES, "no shutdown", eachInterface((_ctx, i) => {
    i.adminUp = true;
  }));

  const speedDuplex = eachInterface((ctx, i, { value }) => {
    if (!isPhysical(i)) {
      ctx.print("% Invalid input detected: speed/duplex only on physical ports");
      return;
    }
    if (value === "1000" && i.type === "FastEthernet") {
      ctx.print("% Invalid input detected: FastEthernet supports 10/100 only");
      return;
    }
    if (/^(10|100|1000|auto)$/.test(value!) && !/^(full|half)$/.test(value!)) i.speed = value as typeof i.speed;
  });
  t.add(IF_MODES, "speed $value", speedDuplex, {
    params: { value: P.pattern(/^(10|100|1000|auto)$/, "10|100|1000|auto", "Force speed / enable autonegotiation") },
  });
  t.add(IF_MODES, "duplex $value", eachInterface((ctx, i, { value }) => {
    if (!isPhysical(i)) {
      ctx.print("% Invalid input detected: speed/duplex only on physical ports");
      return;
    }
    i.duplex = value as typeof i.duplex;
  }), { params: { value: P.pattern(/^(auto|full|half)$/, "auto|full|half", "Duplex mode") } });
  t.add(IF_MODES, "mdix auto", () => {});
  t.add(IF_MODES, "cdp enable", eachInterface((_ctx, i) => {
    i.cdpEnabled = true;
  }));
  t.add(IF_MODES, "no cdp enable", eachInterface((_ctx, i) => {
    i.cdpEnabled = false;
  }));

  // ----- IP -----
  t.add(IF_MODES, "ip address $ip $mask", eachInterface((ctx, iface, { ip, mask }) => {
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
  }), { params: { ip: P.ipv4("IP address"), mask: P.mask() }, help: { ip: "Interface Internet Protocol config commands" } });
  t.add(IF_MODES, "no ip address", eachInterface((_ctx, i) => {
    delete i.ipv4;
  }));
  const helper = { params: { ip: P.ipv4("IP destination address") } };
  t.add(IF_MODES, "ip helper-address $ip", eachInterface((_ctx, i, { ip }) => {
    if (!i.helperAddresses.includes(ip!)) i.helperAddresses.push(ip!);
  }), helper);
  t.add(IF_MODES, "no ip helper-address $ip", eachInterface((_ctx, i, { ip }) => {
    i.helperAddresses = i.helperAddresses.filter((h) => h !== ip);
  }), helper);

  if (!isSwitch) return;

  // ----- Switchport -----
  const setMode = (mode: SwitchportMode) =>
    eachSwitchport((ctx, i) => {
      const sp = i.switchport!;
      if (mode === "trunk" && sp.encapsulation === "negotiate") {
        ctx.print('Command rejected: An interface whose trunk encapsulation is "Auto" can not be configured to "trunk" mode.');
        return;
      }
      if (mode.startsWith("dynamic") && sp.nonegotiate) {
        ctx.print("Command rejected: Conflict between 'nonegotiate' and 'dynamic' status.");
        return;
      }
      if (mode.startsWith("dynamic") && i.portSecurity.enabled) {
        ctx.print(`Command rejected: ${i.name} is a secure port.`);
        return;
      }
      sp.mode = mode;
    });
  t.add(IF_MODES, "switchport mode access", setMode("access"), { help: { access: "Set trunking mode to ACCESS unconditionally" } });
  t.add(IF_MODES, "switchport mode trunk", setMode("trunk"), { help: { trunk: "Set trunking mode to TRUNK unconditionally" } });
  t.add(IF_MODES, "switchport mode dynamic auto", setMode("dynamic-auto"), { help: { auto: "Set trunking mode dynamic negotiation parameter to AUTO" } });
  t.add(IF_MODES, "switchport mode dynamic desirable", setMode("dynamic-desirable"), {
    help: { desirable: "Set trunking mode dynamic negotiation parameter to DESIRABLE" },
  });
  t.add(IF_MODES, "switchport nonegotiate", eachSwitchport((ctx, i) => {
    if (i.switchport!.mode.startsWith("dynamic")) {
      ctx.print("Command rejected: Conflict between 'nonegotiate' and 'dynamic' status.");
      return;
    }
    i.switchport!.nonegotiate = true;
  }));
  t.add(IF_MODES, "no switchport nonegotiate", eachSwitchport((_ctx, i) => {
    i.switchport!.nonegotiate = false;
  }));

  const vlanId = (help: string) => ({ params: { id: P.number(1, 4094, help) } });
  t.add(IF_MODES, "switchport access vlan $id", eachSwitchport((ctx, i, { id }) => {
    const n = Number(id);
    if (!ctx.device.vlans.has(n)) {
      if (ctx.device.vtp.mode === "client") {
        ctx.print(`% Access VLAN does not exist. Creating vlan ${n} is not allowed in VTP client mode`);
      } else {
        ctx.print(`% Access VLAN does not exist. Creating vlan ${n}`);
        ensureVlan(ctx.device, n);
      }
    }
    i.switchport!.accessVlan = n;
  }), vlanId("VLAN ID of the VLAN when this port is in access mode"));
  t.add(IF_MODES, "no switchport access vlan", eachSwitchport((_ctx, i) => {
    i.switchport!.accessVlan = 1;
  }));
  t.add(IF_MODES, "switchport voice vlan $id", eachSwitchport((ctx, i, { id }) => {
    ensureVlan(ctx.device, Number(id));
    i.switchport!.voiceVlan = Number(id);
  }), vlanId("Vlan for voice traffic"));
  t.add(IF_MODES, "no switchport voice vlan", eachSwitchport((_ctx, i) => {
    i.switchport!.voiceVlan = null;
  }));
  t.add(IF_MODES, "switchport trunk native vlan $id", eachSwitchport((_ctx, i, { id }) => {
    i.switchport!.nativeVlan = Number(id);
  }), vlanId("VLAN ID of the native VLAN when this port is in trunking mode"));
  t.add(IF_MODES, "no switchport trunk native vlan", eachSwitchport((_ctx, i) => {
    i.switchport!.nativeVlan = 1;
  }));

  const allowed = (op: "set" | "add" | "remove" | "except") =>
    eachSwitchport((_ctx, i, { list }) => {
      const sp = i.switchport!;
      const ids = parseVlanList(list!)!;
      const current = sp.allowedVlans === "all" ? parseVlanList("1-4094")! : sp.allowedVlans;
      let next: number[];
      if (op === "set") next = ids;
      else if (op === "add") next = [...new Set([...current, ...ids])];
      else if (op === "remove") next = current.filter((v) => !ids.includes(v));
      else next = parseVlanList("1-4094")!.filter((v) => !ids.includes(v));
      next.sort((a, b) => a - b);
      sp.allowedVlans = next.length === 4094 ? "all" : next;
    });
  const listParam = { params: { list: P.vlanList() } };
  t.add(IF_MODES, "switchport trunk allowed vlan $list", allowed("set"), listParam);
  t.add(IF_MODES, "switchport trunk allowed vlan add $list", allowed("add"), listParam);
  t.add(IF_MODES, "switchport trunk allowed vlan remove $list", allowed("remove"), listParam);
  t.add(IF_MODES, "switchport trunk allowed vlan except $list", allowed("except"), listParam);
  t.add(IF_MODES, "switchport trunk allowed vlan all", eachSwitchport((_ctx, i) => {
    i.switchport!.allowedVlans = "all";
  }));
  t.add(IF_MODES, "switchport trunk allowed vlan none", eachSwitchport((_ctx, i) => {
    i.switchport!.allowedVlans = [];
  }));
  t.add(IF_MODES, "no switchport trunk allowed vlan", eachSwitchport((_ctx, i) => {
    i.switchport!.allowedVlans = "all";
  }));

  if (kind === "switch-l3") {
    t.add(IF_MODES, "switchport trunk encapsulation $enc", eachSwitchport((_ctx, i, { enc }) => {
      i.switchport!.encapsulation = enc as "dot1q" | "isl" | "negotiate";
    }), { params: { enc: P.pattern(/^(dot1q|isl|negotiate)$/, "dot1q|isl|negotiate", "Set trunking encapsulation") } });
    t.add(IF_MODES, "no switchport", eachInterface((ctx, i) => {
      if (isVirtual(i)) {
        ctx.print("% Invalid input detected: not a switchport");
        return;
      }
      i.switchport = null;
    }));
    t.add(IF_MODES, "switchport", eachInterface((ctx, i) => {
      if (isVirtual(i)) {
        ctx.print("% Invalid input detected: not a switchport");
        return;
      }
      if (!i.switchport) {
        delete i.ipv4;
        i.switchport = defaultSwitchport(kind);
      }
    }));
  }

  // ----- Port security -----
  const secure = (fn: Parameters<typeof eachSwitchport>[0]) =>
    eachSwitchport((ctx, i, args) => {
      if (i.switchport!.mode.startsWith("dynamic")) {
        ctx.print(`Command rejected: ${i.name} is a dynamic port.`);
        return;
      }
      fn(ctx, i, args);
    });
  t.add(IF_MODES, "switchport port-security", secure((_ctx, i) => {
    i.portSecurity.enabled = true;
  }));
  t.add(IF_MODES, "no switchport port-security", eachSwitchport((_ctx, i) => {
    i.portSecurity.enabled = false;
  }));
  t.add(IF_MODES, "switchport port-security maximum $n", secure((ctx, i, { n }) => {
    const max = Number(n);
    const known = i.portSecurity.staticMacs.length + i.portSecurity.stickyMacs.length;
    if (max < known) {
      ctx.print(`Total secure mac-addresses on interface ${i.name} has exceeded the specified maximum`);
      return;
    }
    i.portSecurity.maximum = max;
  }), { params: { n: P.number(1, 8192, "Maximum addresses") } });
  t.add(IF_MODES, "switchport port-security violation $mode", secure((_ctx, i, { mode }) => {
    i.portSecurity.violation = mode as PortSecurityViolation;
  }), { params: { mode: P.pattern(/^(protect|restrict|shutdown)$/, "protect|restrict|shutdown", "Security violation mode") } });
  t.add(IF_MODES, "switchport port-security mac-address sticky", secure((_ctx, i) => {
    i.portSecurity.sticky = true;
  }));
  t.add(IF_MODES, "no switchport port-security mac-address sticky", eachSwitchport((_ctx, i) => {
    i.portSecurity.sticky = false;
    i.portSecurity.stickyMacs = [];
  }));
  const addSecureMac = (sticky: boolean) =>
    secure((ctx, i, { mac }) => {
      const m = parseMac(mac!)!;
      const ps = i.portSecurity;
      const list = sticky ? ps.stickyMacs : ps.staticMacs;
      if (list.includes(m)) return;
      if (ps.staticMacs.length + ps.stickyMacs.length >= ps.maximum) {
        ctx.print(`Total secure mac-addresses on interface ${i.name} has reached maximum limit.`);
        return;
      }
      list.push(m);
    });
  const macParam = { params: { mac: P.mac("48 bit mac address") } };
  t.add(IF_MODES, "switchport port-security mac-address $mac", addSecureMac(false), macParam);
  t.add(IF_MODES, "switchport port-security mac-address sticky $mac", addSecureMac(true), macParam);
  t.add(IF_MODES, "no switchport port-security mac-address $mac", eachSwitchport((_ctx, i, { mac }) => {
    const m = parseMac(mac!)!;
    i.portSecurity.staticMacs = i.portSecurity.staticMacs.filter((x) => x !== m);
  }), macParam);
  t.add(IF_MODES, "switchport port-security aging time $n", secure((_ctx, i, { n }) => {
    i.portSecurity.agingMinutes = Number(n);
  }), { params: { n: P.number(0, 1440, "Aging time in minutes") } });

  // ----- Spanning tree (per port) -----
  t.add(IF_MODES, "spanning-tree portfast", eachInterface((ctx, i) => {
    i.stp.portfast = "enable";
    ctx.print(
      "%Warning: portfast should only be enabled on ports connected to a single",
      " host. Connecting hubs, concentrators, switches, bridges, etc... to this",
      " interface  when portfast is enabled, can cause temporary bridging loops.",
      " Use with CAUTION",
      "",
      `%Portfast has been configured on ${i.name} but will only`,
      " have effect when the interface is in a non-trunking mode.",
    );
  }));
  t.add(IF_MODES, "spanning-tree portfast trunk", eachInterface((_ctx, i) => {
    i.stp.portfast = "trunk";
  }));
  t.add(IF_MODES, "spanning-tree portfast disable", eachInterface((_ctx, i) => {
    i.stp.portfast = "disable";
  }));
  t.add(IF_MODES, "no spanning-tree portfast", eachInterface((_ctx, i) => {
    i.stp.portfast = "default";
  }));
  t.add(IF_MODES, "spanning-tree bpduguard enable", eachInterface((_ctx, i) => {
    i.stp.bpduguard = "enable";
  }));
  t.add(IF_MODES, "spanning-tree bpduguard disable", eachInterface((_ctx, i) => {
    i.stp.bpduguard = "disable";
  }));
  t.add(IF_MODES, "no spanning-tree bpduguard", eachInterface((_ctx, i) => {
    i.stp.bpduguard = "default";
  }));
  t.add(IF_MODES, "spanning-tree cost $n", eachInterface((_ctx, i, { n }) => {
    i.stp.cost = Number(n);
  }), { params: { n: P.number(1, 200000000, "port path cost") } });
  t.add(IF_MODES, "no spanning-tree cost", eachInterface((_ctx, i) => {
    i.stp.cost = null;
  }));
  t.add(IF_MODES, "spanning-tree port-priority $n", eachInterface((ctx, i, { n }) => {
    if (Number(n) % 16 !== 0) {
      ctx.print("% Port Priority in increments of 16 is required");
      return;
    }
    i.stp.portPriority = Number(n);
  }), { params: { n: P.number(0, 240, "port priority in increments of 16") } });

  // ----- EtherChannel -----
  t.add(IF_MODES, "channel-group $id mode $mode", eachInterface((ctx, i, { id, mode }) => {
    if (!isPhysical(i)) {
      ctx.print("% Invalid input detected: channel-group only on physical ports");
      return;
    }
    const group = Number(id);
    const m = mode as ChannelMode;
    const proto = (x: ChannelMode) => (x === "active" || x === "passive" ? "lacp" : x === "on" ? "on" : "pagp");
    const other = ctx.device.interfaces.find((p) => p !== i && p.channelGroup?.id === group);
    if (other && proto(other.channelGroup!.mode) !== proto(m)) {
      ctx.print(
        `Command rejected (Channel protocol mismatch for interface ${shortInterfaceName(i)} in group ${group}): the interface can not be added to the channel group`,
      );
      return;
    }
    let po = ctx.device.interfaces.find((p) => p.type === "Port-channel" && Number(p.number) === group);
    if (!po) {
      ctx.print(`Creating a port-channel interface Port-channel ${group}`);
      po = addVirtualInterface(ctx.device, "Port-channel", String(group));
      po.switchport = i.switchport ? cloneSwitchport(i.switchport) : null;
    } else if (po.switchport && i.switchport) {
      i.switchport = cloneSwitchport(po.switchport);
    }
    i.channelGroup = { id: group, mode: m };
  }), {
    params: {
      id: P.number(1, 48, "Channel group number"),
      mode: P.pattern(/^(active|passive|on|desirable|auto)$/, "active|passive|on|desirable|auto", "Etherchannel Mode of the interface"),
    },
  });
  t.add(IF_MODES, "no channel-group", eachInterface((_ctx, i) => {
    i.channelGroup = null;
  }));

  // ----- DHCP snooping / DAI -----
  t.add(IF_MODES, "ip dhcp snooping trust", eachInterface((_ctx, i) => {
    i.dhcpSnoopingTrust = true;
  }));
  t.add(IF_MODES, "no ip dhcp snooping trust", eachInterface((_ctx, i) => {
    i.dhcpSnoopingTrust = false;
  }));
  t.add(IF_MODES, "ip dhcp snooping limit rate $n", () => {}, { params: { n: P.number(1, 2048, "DHCP snooping rate limit") } });
  t.add(IF_MODES, "ip arp inspection trust", eachInterface((_ctx, i) => {
    i.arpInspectionTrust = true;
  }));
  t.add(IF_MODES, "no ip arp inspection trust", eachInterface((_ctx, i) => {
    i.arpInspectionTrust = false;
  }));
}
