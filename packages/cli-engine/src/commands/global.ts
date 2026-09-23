/** Global configuration commands: (config)# */
import { INTERFACE_TYPES, newInterface, parseInterfaceName, shortInterfaceName } from "../device";
import { P, type CommandTree } from "../grammar";
import { networkOf, parseMac, parseVlanList } from "../net";
import { hashSecret, parseSecret } from "../passwords";
import { plainOrType7 } from "./secrets";
import type { CommandContext } from "../session";
import type { InterfaceState, IosDeviceKind, VtpMode } from "../types";
import {
  IF_NUMBER_LABEL,
  addIfCommand,
  ensureVlan,
  interfaceTypes,
  parseRange,
  resolveOrCreate,
  splitTypedSecret,
  vlanDbChanged,
  vtpClientRejects,
} from "./helpers";

function enterInterfaces(ctx: CommandContext, ifaces: InterfaceState[], range: boolean): void {
  ctx.session.currentInterfaces = ifaces;
  ctx.session.mode = range ? "config-if-range" : "config-if";
}

export function registerGlobal(t: CommandTree, kind: IosDeviceKind): void {
  const isSwitch = kind !== "router";
  const routes = kind !== "switch-l2";

  // ----- Identity -----
  t.add("config", "hostname $name", (ctx, { name }) => {
    if (!/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(name!)) {
      ctx.print("% Hostname contains one or more illegal characters.");
      return;
    }
    ctx.device.hostname = name!;
  }, { params: { name: P.word("This system's network name") } });
  t.add("config", "no hostname", (ctx) => {
    ctx.device.hostname = kind === "router" ? "Router" : "Switch";
  });

  // ----- Passwords -----
  const secretParams = { params: { text: P.line("The UNENCRYPTED (cleartext) 'enable' secret") } };
  t.add("config", "enable secret $text", (ctx, { text }) => {
    const { type, value } = splitTypedSecret(text!);
    if (type === 9 || type === 5 || type === 8) {
      const parsed = parseSecret(value);
      if (!parsed) {
        ctx.print("ERROR: The secret you entered is not a valid encrypted secret.");
        return;
      }
      ctx.device.enableSecret = parsed;
      return;
    }
    ctx.device.enableSecret = hashSecret(value);
  }, secretParams);
  t.add("config", "enable password $text", (ctx, { text }) => {
    const plain = plainOrType7(ctx, text!);
    if (plain === null) return;
    if (ctx.device.enableSecret && ctx.device.enableSecret.hash === hashSecret(plain, ctx.device.enableSecret.salt).hash) {
      ctx.print("The enable password you have chosen is the same as your enable secret.", "This is not recommended.  Re-enter the enable password.");
      return;
    }
    ctx.device.enablePassword = plain;
  }, { params: { text: P.line("The UNENCRYPTED (cleartext) 'enable' password") } });
  t.add("config", "no enable secret", (ctx) => {
    ctx.device.enableSecret = null;
  });
  t.add("config", "no enable password", (ctx) => {
    ctx.device.enablePassword = null;
  });
  t.add("config", "service password-encryption", (ctx) => {
    ctx.device.servicePasswordEncryption = true;
  });
  t.add("config", "no service password-encryption", (ctx) => {
    ctx.device.servicePasswordEncryption = false;
  });

  const userParams = {
    params: {
      name: P.word("User name"),
      level: P.number(0, 15, "User privilege level"),
      text: P.line("The UNENCRYPTED (cleartext) user password"),
    },
  };
  const setUser = (ctx: CommandContext, name: string, level: string | undefined, text: string, secret: boolean) => {
    const privilege = level === undefined ? 1 : Number(level);
    if (secret) {
      const { type, value } = splitTypedSecret(text);
      const parsed = type === 9 || type === 5 ? parseSecret(value) : hashSecret(value);
      if (!parsed) {
        ctx.print("ERROR: The secret you entered is not a valid encrypted secret.");
        return;
      }
      ctx.device.users.set(name, { privilege, secret: parsed });
    } else {
      const plain = plainOrType7(ctx, text);
      if (plain !== null) ctx.device.users.set(name, { privilege, password: plain });
    }
  };
  t.add("config", "username $name secret $text", (ctx, a) => setUser(ctx, a.name!, undefined, a.text!, true), userParams);
  t.add("config", "username $name password $text", (ctx, a) => setUser(ctx, a.name!, undefined, a.text!, false), userParams);
  t.add("config", "username $name privilege $level secret $text", (ctx, a) => setUser(ctx, a.name!, a.level, a.text!, true), userParams);
  t.add("config", "username $name privilege $level password $text", (ctx, a) => setUser(ctx, a.name!, a.level, a.text!, false), userParams);
  t.add("config", "no username $name", (ctx, { name }) => {
    ctx.device.users.delete(name!);
  }, userParams);

  // ----- Banners (single line "#text#" or multi-line until the delimiter) -----
  for (const which of ["motd", "login", "exec"] as const) {
    t.add("config", `banner ${which} $text`, (ctx, { text }) => {
      const raw = text!;
      const delim = raw.startsWith("^C") ? "^C" : raw[0]!;
      const body = raw.slice(delim.length);
      const end = body.indexOf(delim);
      if (end !== -1) {
        ctx.device.banners[which] = body.slice(0, end);
        return;
      }
      const lines = body.length ? [body] : [];
      ctx.print(`Enter TEXT message.  End with the character '${delim === "^C" ? "^C" : delim}'.`);
      const collect = (input: string): string[] => {
        const i = input.indexOf(delim);
        if (i === -1) {
          lines.push(input);
          ctx.session.ask("", collect);
          return [];
        }
        if (i > 0) lines.push(input.slice(0, i));
        ctx.device.banners[which] = lines.join("\n");
        return [];
      };
      ctx.session.ask("", collect);
    }, { params: { text: P.line("c  banner-text c, where 'c' is a delimiting character") } });
    t.add("config", `no banner ${which}`, (ctx) => {
      delete ctx.device.banners[which];
    });
  }

  // ----- IP services -----
  const domain = (ctx: CommandContext, name: string) => {
    ctx.device.domainName = name;
  };
  t.add("config", "ip domain-name $name", (ctx, { name }) => domain(ctx, name!), { params: { name: P.word("Default domain name") } });
  t.add("config", "ip domain name $name", (ctx, { name }) => domain(ctx, name!), { params: { name: P.word("Default domain name") } });
  t.add("config", "no ip domain-name", (ctx) => {
    ctx.device.domainName = null;
  });
  t.add("config", "ip domain-lookup", (ctx) => {
    ctx.device.domainLookup = true;
  });
  t.add("config", "no ip domain-lookup", (ctx) => {
    ctx.device.domainLookup = false;
  });
  t.add("config", "ip domain lookup", (ctx) => {
    ctx.device.domainLookup = true;
  });
  t.add("config", "no ip domain lookup", (ctx) => {
    ctx.device.domainLookup = false;
  });
  const ns = { params: { ip: P.ipv4("Domain server IP address (maximum of 6)") } };
  t.add("config", "ip name-server $ip", (ctx, { ip }) => {
    if (!ctx.device.nameServers.includes(ip!)) ctx.device.nameServers.push(ip!);
  }, ns);
  t.add("config", "no ip name-server $ip", (ctx, { ip }) => {
    ctx.device.nameServers = ctx.device.nameServers.filter((s) => s !== ip);
  }, ns);
  if (isSwitch) {
    const gw = { params: { ip: P.ipv4("IP address of default gateway") } };
    t.add("config", "ip default-gateway $ip", (ctx, { ip }) => {
      ctx.device.defaultGateway = ip!;
    }, gw);
    t.add("config", "no ip default-gateway", (ctx) => {
      ctx.device.defaultGateway = null;
    });
  }
  if (routes) {
    t.add("config", "ip routing", (ctx) => {
      ctx.device.ipRouting = true;
    });
    t.add("config", "no ip routing", (ctx) => {
      ctx.device.ipRouting = false;
    });
    const routeParams = {
      params: {
        network: P.ipv4("Destination prefix"),
        mask: P.mask("Destination prefix mask"),
        nextHop: P.ipv4("Forwarding router's address"),
      },
      help: { route: "Establish static routes" },
    };
    t.add("config", "ip route $network $mask $nextHop", (ctx, { network, mask, nextHop }) => {
      if (networkOf(network!, mask!) !== network) {
        ctx.print("%Inconsistent address and mask");
        return;
      }
      const exists = ctx.device.staticRoutes.some((r) => r.network === network && r.mask === mask && r.nextHop === nextHop);
      if (!exists) ctx.device.staticRoutes.push({ network: network!, mask: mask!, nextHop: nextHop! });
    }, routeParams);
    t.add("config", "no ip route $network $mask $nextHop", (ctx, { network, mask, nextHop }) => {
      ctx.device.staticRoutes = ctx.device.staticRoutes.filter(
        (r) => !(r.network === network && r.mask === mask && r.nextHop === nextHop),
      );
    }, routeParams);
  }

  // ----- SSH -----
  t.add("config", "ip ssh version $v", (ctx, { v }) => {
    if (v === "2" && (!ctx.device.ssh.rsaBits || ctx.device.ssh.rsaBits < 768)) {
      ctx.print("Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).");
      return;
    }
    ctx.device.ssh.version = Number(v) as 1 | 2;
  }, { params: { v: P.number(1, 2, "Protocol version") } });
  t.add("config", "no ip ssh version", (ctx) => {
    ctx.device.ssh.version = null;
  });
  t.add("config", "ip ssh time-out $n", (ctx, { n }) => {
    ctx.device.ssh.timeout = Number(n);
  }, { params: { n: P.number(1, 120, "SSH time-out interval (secs)") } });
  t.add("config", "ip ssh authentication-retries $n", (ctx, { n }) => {
    ctx.device.ssh.retries = Number(n);
  }, { params: { n: P.number(0, 5, "Number of authentication retries") } });

  const generateRsa = (ctx: CommandContext, bits: number | null) => {
    const dev = ctx.device;
    if (dev.hostname === "Switch" || dev.hostname === "Router") {
      ctx.print(`% Please define a hostname other than ${dev.hostname}.`);
      return;
    }
    if (!dev.domainName) {
      ctx.print("% Please define a domain-name first.");
      return;
    }
    const finish = (n: number): string[] => {
      if (n < 360 || n > 4096) return ["% Invalid modulus. Must be between 360 and 4096"];
      dev.ssh.rsaBits = n;
      return [
        `% Generating ${n} bit RSA keys, keys will be non-exportable...`,
        "[OK] (elapsed time was 1 seconds)",
        "",
        `%SSH-5-ENABLED: SSH ${dev.ssh.version === 2 && n >= 768 ? "2.0" : "1.99"} has been enabled`,
      ];
    };
    const header = [
      `The name for the keys will be: ${dev.hostname}.${dev.domainName}`,
    ];
    if (bits !== null) {
      ctx.print(...header, ...finish(bits));
      return;
    }
    ctx.print(
      ...header,
      "Choose the size of the key modulus in the range of 360 to 4096 for your",
      "  General Purpose Keys. Choosing a key modulus greater than 512 may take",
      "  a few minutes.",
      "",
    );
    ctx.session.ask("How many bits in the modulus [512]: ", (input) => finish(input.trim() === "" ? 512 : Number(input.trim())));
  };
  const modulus = { params: { bits: P.number(360, 4096, "size of the key modulus [360-4096]") } };
  t.add("config", "crypto key generate rsa", (ctx) => generateRsa(ctx, null));
  t.add("config", "crypto key generate rsa modulus $bits", (ctx, { bits }) => generateRsa(ctx, Number(bits)), modulus);
  t.add("config", "crypto key generate rsa general-keys modulus $bits", (ctx, { bits }) => generateRsa(ctx, Number(bits)), modulus);
  t.add("config", "crypto key zeroize rsa", (ctx) => {
    ctx.session.ask("% All keys will be removed.\n% All router certs issued using these keys will also be removed.\nDo you really want to remove these keys? [yes/no]: ", (input) => {
      if (!/^y/i.test(input.trim())) return [];
      ctx.device.ssh.rsaBits = null;
      return ["%SSH-5-DISABLED: SSH 1.99 has been disabled"];
    });
  });

  // ----- Lines -----
  t.add("config", "line console 0", (ctx) => {
    ctx.session.currentLines = { kind: "console", from: 0, to: 0 };
    ctx.session.mode = "config-line";
  }, { help: { console: "Primary terminal line", "0": "First Line number" } });
  const vty = { params: { from: P.number(0, 15, "First Line number"), to: P.number(1, 15, "Last Line number") } };
  t.add("config", "line vty $from $to", (ctx, { from, to }) => {
    if (Number(to) < Number(from)) {
      ctx.print("%Invalid line range");
      return;
    }
    ctx.session.currentLines = { kind: "vty", from: Number(from), to: Number(to) };
    ctx.session.mode = "config-line";
  }, vty);
  t.add("config", "line vty $from", (ctx, { from }) => {
    ctx.session.currentLines = { kind: "vty", from: Number(from), to: Number(from) };
    ctx.session.mode = "config-line";
  }, vty);

  // ----- Interfaces -----
  for (const type of interfaceTypes(kind)) {
    const [label, help] = IF_NUMBER_LABEL[type];
    t.add("config", `interface ${type} $number`, (ctx, { number }) => {
      const found = resolveOrCreate(ctx.device, type, number!);
      if (typeof found === "string") ctx.print(found);
      else enterInterfaces(ctx, [found], false);
    }, { params: { number: P.ifNumber(label, help) }, help: { [type]: INTERFACE_TYPES[type].help } });
  }
  t.add("config", "interface $ifname", (ctx, { ifname }) => {
    const parsed = parseInterfaceName(ifname!);
    if (!parsed || !interfaceTypes(kind).includes(parsed.type)) {
      ctx.print("%Invalid interface type and number");
      return;
    }
    const found = resolveOrCreate(ctx.device, parsed.type, parsed.number);
    if (typeof found === "string") ctx.print(found);
    else enterInterfaces(ctx, [found], false);
  }, { params: { ifname: P.ifName() } });
  t.add("config", "interface range $spec", (ctx, { spec }) => {
    const found = parseRange(ctx.device, spec!);
    if (typeof found === "string") ctx.print(found);
    else enterInterfaces(ctx, found, true);
  }, { params: { spec: P.line("Interface range, e.g. fa0/1 - 12, gi0/1 - 2") }, help: { range: "interface range command" } });
  addIfCommand(t, kind, "config", "default interface", "", (ctx, i) => {
    const fresh = newInterface(ctx.device, i.type, i.number, 0);
    Object.assign(i, { ...fresh, mac: i.mac, carrier: i.carrier });
    ctx.print(`Interface ${i.name} set to default configuration`);
  });

  // ----- VLANs, VTP, STP (switches) -----
  if (isSwitch) {
    const vlanList = { params: { list: P.vlanList("ISL VLAN IDs 1-1005, e.g. 10 or 10,20,30-35") }, help: { vlan: "Vlan commands" } };
    t.add("config", "vlan $list", (ctx, { list }) => {
      const ids = parseVlanList(list!)!;
      if (vtpClientRejects(ctx)) return;
      for (const id of ids) {
        if (id >= 1002 && id <= 1005) {
          ctx.print(`Default VLAN ${id} may not have its name changed.`);
          continue;
        }
        ensureVlan(ctx.device, id);
      }
      ctx.session.currentVlan = ids.length === 1 ? ids[0]! : null;
      ctx.session.mode = "config-vlan";
    }, vlanList);
    t.add("config", "no vlan $list", (ctx, { list }) => {
      if (vtpClientRejects(ctx)) return;
      for (const id of parseVlanList(list!)!) {
        if (id === 1 || (id >= 1002 && id <= 1005)) {
          ctx.print(`%Default VLAN ${id} may not be deleted.`);
          continue;
        }
        if (ctx.device.vlans.delete(id)) vlanDbChanged(ctx.device);
      }
    }, vlanList);

    t.add("config", "vtp mode $mode", (ctx, { mode }) => {
      const m = mode!.toLowerCase() as VtpMode;
      const dev = ctx.device;
      if (dev.vtp.mode === m) {
        ctx.print(`Device mode already VTP ${m.toUpperCase()}.`);
        return;
      }
      dev.vtp.mode = m;
      if (m === "transparent" || m === "off") dev.vtp.revision = 0;
      ctx.print(`Setting device to VTP ${m.toUpperCase()} mode.`);
    }, { params: { mode: P.pattern(/^(server|client|transparent|off)$/i, "server|client|transparent|off", "VTP device mode") } });
    t.add("config", "vtp domain $name", (ctx, { name }) => {
      const dev = ctx.device;
      if (dev.vtp.domain === name) {
        ctx.print(`Domain name already set to ${name}.`);
        return;
      }
      const old = dev.vtp.domain || "NULL";
      dev.vtp.domain = name!;
      dev.vtp.revision = 0;
      ctx.print(`Changing VTP domain name from ${old} to ${name}`);
    }, { params: { name: P.word("The ascii name for the VTP administrative domain.") } });
    t.add("config", "vtp password $pw", (ctx, { pw }) => {
      ctx.device.vtp.password = pw!;
      ctx.print(`Setting device VTP password to ${pw}`);
    }, { params: { pw: P.word("The ascii password for the VTP administrative domain.") } });
    t.add("config", "no vtp password", (ctx) => {
      ctx.device.vtp.password = null;
      ctx.print("Clearing device VTP password.");
    });
    t.add("config", "vtp version $v", (ctx, { v }) => {
      ctx.device.vtp.version = Number(v) as 1 | 2 | 3;
    }, { params: { v: P.number(1, 3, "Set the adminstrative domain VTP version number") } });
    t.add("config", "vtp pruning", (ctx) => {
      ctx.device.vtp.pruning = true;
      ctx.print("Pruning switched on");
    });
    t.add("config", "no vtp pruning", (ctx) => {
      ctx.device.vtp.pruning = false;
      ctx.print("Pruning switched off");
    });

    t.add("config", "spanning-tree mode $mode", (ctx, { mode }) => {
      ctx.device.stp.mode = mode!.toLowerCase() as "pvst" | "rapid-pvst" | "mst";
    }, { params: { mode: P.pattern(/^(pvst|rapid-pvst|mst)$/i, "pvst|rapid-pvst|mst", "Spanning tree operating mode") } });
    const stpVlan = {
      params: {
        list: P.vlanList("vlan range, example: 1,3-5,7,9-11"),
        prio: P.number(0, 61440, "bridge priority in increments of 4096"),
      },
    };
    t.add("config", "spanning-tree vlan $list priority $prio", (ctx, { list, prio }) => {
      const p = Number(prio);
      if (p % 4096 !== 0) {
        ctx.print(
          "% Bridge Priority must be in increments of 4096.",
          "% Allowed values are:",
          "  0     4096  8192  12288 16384 20480 24576 28672",
          "  32768 36864 40960 45056 49152 53248 57344 61440",
        );
        return;
      }
      for (const v of parseVlanList(list!)!) ctx.device.stp.priorities.set(v, p);
    }, stpVlan);
    t.add("config", "no spanning-tree vlan $list priority", (ctx, { list }) => {
      for (const v of parseVlanList(list!)!) ctx.device.stp.priorities.delete(v);
    }, stpVlan);
    t.add("config", "spanning-tree vlan $list root $which", (ctx, { list, which }) => {
      for (const v of parseVlanList(list!)!) {
        if (which === "secondary") {
          ctx.device.stp.priorities.set(v, 28672);
          continue;
        }
        const root = ctx.device.stp.root.get(v);
        const rootPrio = root ? root.priority - v : 32768;
        const isSelf = root?.mac === ctx.device.baseMac;
        const target = isSelf ? Math.min(rootPrio, 24576) : rootPrio > 24576 ? 24576 : Math.max(0, rootPrio - 4096);
        ctx.device.stp.priorities.set(v, target);
      }
    }, { params: { ...stpVlan.params, which: P.pattern(/^(primary|secondary)$/, "primary|secondary", "Configure switch as root") } });
    t.add("config", "spanning-tree portfast default", (ctx) => {
      ctx.device.stp.portfastDefault = true;
      ctx.print(
        "%Warning: this command enables portfast by default on all interfaces. You",
        " should now disable portfast explicitly on switched ports leading to hubs,",
        " switches and bridges as they may create temporary bridging loops.",
      );
    });
    t.add("config", "no spanning-tree portfast default", (ctx) => {
      ctx.device.stp.portfastDefault = false;
    });
    t.add("config", "spanning-tree portfast bpduguard default", (ctx) => {
      ctx.device.stp.bpduguardDefault = true;
    });
    t.add("config", "no spanning-tree portfast bpduguard default", (ctx) => {
      ctx.device.stp.bpduguardDefault = false;
    });
    t.add("config", "spanning-tree extend system-id", () => {});

    // MAC table
    const macParams = {
      params: { mac: P.mac("48 bit mac address"), vlan: P.number(1, 4094, "VLAN id of mac address table") },
    };
    addIfCommand(t, kind, "config", "mac address-table static $mac vlan $vlan interface", "", (ctx, i, { mac, vlan }) => {
      const m = parseMac(mac!)!;
      const v = Number(vlan);
      ctx.device.macTable = ctx.device.macTable.filter((e) => !(e.mac === m && e.vlan === v));
      ctx.device.macTable.push({ vlan: v, mac: m, type: "STATIC", port: shortInterfaceName(i) });
    }, macParams);
    addIfCommand(t, kind, "config", "no mac address-table static $mac vlan $vlan interface", "", (ctx, _i, { mac, vlan }) => {
      const m = parseMac(mac!)!;
      ctx.device.macTable = ctx.device.macTable.filter((e) => !(e.type === "STATIC" && e.mac === m && e.vlan === Number(vlan)));
    }, macParams);
    t.add("config", "mac address-table aging-time $n", (ctx, { n }) => {
      ctx.device.macAgingTime = Number(n);
    }, { params: { n: P.number(0, 1000000, "Aging time in seconds (0 disables aging)") } });

    // Security features
    t.add("config", "ip dhcp snooping", (ctx) => {
      ctx.device.dhcpSnooping.enabled = true;
    });
    t.add("config", "no ip dhcp snooping", (ctx) => {
      ctx.device.dhcpSnooping.enabled = false;
    });
    t.add("config", "ip dhcp snooping vlan $list", (ctx, { list }) => {
      const set = new Set([...ctx.device.dhcpSnooping.vlans, ...parseVlanList(list!)!]);
      ctx.device.dhcpSnooping.vlans = [...set].sort((a, b) => a - b);
    }, { params: { list: P.vlanList("DHCP Snooping vlan first number or vlan range") } });
    t.add("config", "ip arp inspection vlan $list", (ctx, { list }) => {
      const set = new Set([...ctx.device.arpInspectionVlans, ...parseVlanList(list!)!]);
      ctx.device.arpInspectionVlans = [...set].sort((a, b) => a - b);
    }, { params: { list: P.vlanList("vlan range, example: 1,3-5,7,9-11") } });
    const causes = /^(bpduguard|psecure-violation|all|link-flap|udld|security-violation)$/;
    t.add("config", "errdisable recovery cause $cause", (ctx, { cause }) => {
      const list = cause === "all" ? ["bpduguard", "psecure-violation", "link-flap", "udld", "security-violation"] : [cause!];
      ctx.device.errdisableRecovery.causes = [...new Set([...ctx.device.errdisableRecovery.causes, ...list])];
    }, { params: { cause: P.pattern(causes, "WORD", "bpduguard | psecure-violation | all ...") } });
    t.add("config", "errdisable recovery interval $n", (ctx, { n }) => {
      ctx.device.errdisableRecovery.interval = Number(n);
    }, { params: { n: P.number(30, 86400, "timer-interval(sec)") } });
  }

  // ----- Discovery / management -----
  t.add("config", "cdp run", (ctx) => {
    ctx.device.cdpRun = true;
  });
  t.add("config", "no cdp run", (ctx) => {
    ctx.device.cdpRun = false;
  });
  t.add("config", "lldp run", (ctx) => {
    ctx.device.lldpRun = true;
  });
  t.add("config", "no lldp run", (ctx) => {
    ctx.device.lldpRun = false;
  });
  const hostIp = { params: { ip: P.ipv4("IP address of the server") } };
  t.add("config", "ntp server $ip", (ctx, { ip }) => {
    if (!ctx.device.ntpServers.includes(ip!)) ctx.device.ntpServers.push(ip!);
  }, hostIp);
  t.add("config", "no ntp server $ip", (ctx, { ip }) => {
    ctx.device.ntpServers = ctx.device.ntpServers.filter((s) => s !== ip);
  }, hostIp);
  t.add("config", "logging host $ip", (ctx, { ip }) => {
    if (!ctx.device.loggingHosts.includes(ip!)) ctx.device.loggingHosts.push(ip!);
  }, hostIp);
  t.add("config", "logging $ip", (ctx, { ip }) => {
    if (!ctx.device.loggingHosts.includes(ip!)) ctx.device.loggingHosts.push(ip!);
  }, hostIp);
  t.add("config", "no logging host $ip", (ctx, { ip }) => {
    ctx.device.loggingHosts = ctx.device.loggingHosts.filter((s) => s !== ip);
  }, hostIp);
}

